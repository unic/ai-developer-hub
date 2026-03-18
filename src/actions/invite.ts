"use server";

import { db } from "@/lib/db";
import { users, inviteTokens } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth-helpers";
import { hash } from "bcryptjs";
import { randomBytes } from "crypto";
import { generateToken, hashToken, buildInviteUrl } from "@/lib/invite";
import { isRateLimited } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";
import { setupPasswordSchema } from "@/lib/validators";
import { recordCreation } from "@/actions/history";
import { InviteEmail } from "@/emails/invite-email";
import type { ActionResult } from "@/types";

const INVITE_EXPIRY_HOURS = 72;

// ---------------------------------------------------------------------------
// createInviteTokenForUser (internal helper — no auth check, no user lookup)
// ---------------------------------------------------------------------------

export async function createInviteTokenForUser(
  userId: number
): Promise<{ inviteUrl: string }> {
  const { raw, hash: tokenHash } = generateToken();
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000);

  const maxRetries = 2;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(inviteTokens)
          .set({ status: "invalidated" })
          .where(
            and(
              eq(inviteTokens.userId, userId),
              eq(inviteTokens.status, "active")
            )
          );

        await tx.insert(inviteTokens).values({
          userId,
          tokenHash,
          status: "active",
          expiresAt,
        });
      });
      return { inviteUrl: buildInviteUrl(raw) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (attempt < maxRetries - 1 && (msg.includes("unique") || msg.includes("duplicate"))) {
        continue;
      }
      throw err;
    }
  }

  throw new Error("Failed to create invite token");
}

// ---------------------------------------------------------------------------
// generateInviteToken (public API — checks admin auth + fetches user)
// ---------------------------------------------------------------------------

export async function generateInviteToken(
  userId: number
): Promise<ActionResult<{ inviteUrl: string }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) return { success: false, error: "User not found" };

  const result = await createInviteTokenForUser(userId);

  revalidatePath("/users");
  revalidatePath(`/users/${userId}`);
  return { success: true, data: result };
}

// ---------------------------------------------------------------------------
// validateInviteToken
// ---------------------------------------------------------------------------

export async function validateInviteToken(
  token: string
): Promise<ActionResult<{ userName: string; userEmail: string }>> {
  if (!token) return { success: false, error: "invalid" };

  const tokenHash = hashToken(token);

  // Look up the token
  const record = await db.query.inviteTokens.findFirst({
    where: eq(inviteTokens.tokenHash, tokenHash),
    with: { user: true },
  });

  if (!record) return { success: false, error: "invalid" };
  if (record.status === "consumed") return { success: false, error: "consumed" };
  if (record.status === "invalidated") return { success: false, error: "invalid" };
  if (record.expiresAt < new Date()) return { success: false, error: "expired" };

  return {
    success: true,
    data: {
      userName: record.user.name,
      userEmail: record.user.email,
    },
  };
}

// ---------------------------------------------------------------------------
// setupPassword
// ---------------------------------------------------------------------------

export async function setupPassword(
  input: unknown
): Promise<ActionResult<{ email: string }>> {
  // Rate limit by IP
  const headerStore = await headers();
  const forwarded = headerStore.get("x-forwarded-for");
  const realIp = headerStore.get("x-real-ip");
  const clientIp = forwarded
    ? forwarded.split(",")[0].trim()
    : realIp ?? "unknown";

  if (isRateLimited(`setup-password:${clientIp}`, { maxAttempts: 10, windowMs: 60_000 })) {
    return { success: false, error: "Too many attempts" };
  }

  // Validate input
  const parsed = setupPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Validation failed",
    };
  }

  const { token, password } = parsed.data;

  // Validate token
  const tokenHash = hashToken(token);
  const record = await db.query.inviteTokens.findFirst({
    where: and(
      eq(inviteTokens.tokenHash, tokenHash),
      eq(inviteTokens.status, "active")
    ),
    with: { user: true },
  });

  if (!record) return { success: false, error: "Invalid or expired token" };
  if (record.expiresAt < new Date()) {
    return { success: false, error: "Token has expired" };
  }

  // Hash new password
  const passwordHash = await hash(password, 12);
  const now = new Date();

  // Update user and consume token in a transaction
  const consumed = await db.transaction(async (tx) => {
    // Atomically consume token — only succeeds if still active
    const updated = await tx
      .update(inviteTokens)
      .set({
        status: "consumed",
        consumedAt: now,
      })
      .where(
        and(
          eq(inviteTokens.id, record.id),
          eq(inviteTokens.status, "active")
        )
      );

    if (updated.rowCount === 0) return false;

    await tx
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: false,
        updatedAt: now,
      })
      .where(eq(users.id, record.userId));

    return true;
  });

  if (!consumed) {
    return { success: false, error: "Token has already been used" };
  }

  return { success: true, data: { email: record.user.email } };
}

// ---------------------------------------------------------------------------
// resetUserPassword
// ---------------------------------------------------------------------------

export async function resetUserPassword(input: {
  userId: number;
  sendEmail: boolean;
}): Promise<ActionResult<{ inviteUrl: string; emailSent: boolean }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const user = await db.query.users.findFirst({
    where: eq(users.id, input.userId),
  });
  if (!user) return { success: false, error: "User not found" };

  // Set password to random bytes so user cannot sign in with old password
  const randomHash = randomBytes(32).toString("hex");
  const now = new Date();

  await db
    .update(users)
    .set({
      passwordHash: randomHash,
      mustChangePassword: true,
      updatedAt: now,
    })
    .where(eq(users.id, input.userId));

  // Generate new invite token (invalidates previous)
  const { inviteUrl } = await createInviteTokenForUser(input.userId);
  let emailSent = false;

  // Optionally send invite email
  if (input.sendEmail) {
    const emailResult = await sendEmail({
      to: user.email,
      subject: "Reset your password — AI Developer Hub",
      react: InviteEmail({
        userName: user.name,
        inviteUrl,
        expiresInHours: INVITE_EXPIRY_HOURS,
      }),
    });
    emailSent = emailResult.success;
  }

  // Record in change history
  await recordCreation("password_reset", input.userId, Number(admin.id));

  revalidatePath("/users");
  revalidatePath(`/users/${input.userId}`);
  return { success: true, data: { inviteUrl, emailSent } };
}

// ---------------------------------------------------------------------------
// sendInviteEmail
// ---------------------------------------------------------------------------

export async function sendInviteEmail(
  userId: number
): Promise<ActionResult<{ emailId: string; inviteUrl: string }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) return { success: false, error: "User not found" };

  // We must generate a fresh token because only the hash is stored (the raw
  // token cannot be recovered). This invalidates any prior active token for
  // the user, which is acceptable since the new link will be emailed.
  const { inviteUrl } = await createInviteTokenForUser(userId);

  const emailResult = await sendEmail({
    to: user.email,
    subject: "You're invited to AI Developer Hub",
    react: InviteEmail({
      userName: user.name,
      inviteUrl,
      expiresInHours: INVITE_EXPIRY_HOURS,
    }),
  });

  if (!emailResult.success) {
    return { success: false, error: emailResult.error ?? "Failed to send email" };
  }

  return { success: true, data: { emailId: emailResult.data?.id ?? "", inviteUrl } };
}

// ---------------------------------------------------------------------------
// sendBatchInviteEmails
// ---------------------------------------------------------------------------

export async function sendBatchInviteEmails(): Promise<
  ActionResult<{
    sent: number;
    failed: number;
    total: number;
    errors: Array<{ userId: number; email: string; error: string }>;
  }>
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  // Find all users who still need to set their password
  const pendingUsers = await db.query.users.findMany({
    where: eq(users.mustChangePassword, true),
  });

  let sent = 0;
  let failed = 0;
  const errors: Array<{ userId: number; email: string; error: string }> = [];

  for (const user of pendingUsers) {
    try {
      // Fresh token required — raw tokens aren't stored, only hashes
      const { inviteUrl } = await createInviteTokenForUser(user.id);

      const emailResult = await sendEmail({
        to: user.email,
        subject: "You're invited to AI Developer Hub",
        react: InviteEmail({
          userName: user.name,
          inviteUrl,
          expiresInHours: INVITE_EXPIRY_HOURS,
        }),
      });

      if (emailResult.success) {
        sent++;
      } else {
        failed++;
        errors.push({
          userId: user.id,
          email: user.email,
          error: emailResult.error ?? "Failed to send email",
        });
      }
    } catch (err) {
      failed++;
      errors.push({
        userId: user.id,
        email: user.email,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return {
    success: true,
    data: {
      sent,
      failed,
      total: pendingUsers.length,
      errors,
    },
  };
}
