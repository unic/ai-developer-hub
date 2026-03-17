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
// generateInviteToken
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

  // Invalidate existing active tokens for this user
  await db
    .update(inviteTokens)
    .set({ status: "invalidated" })
    .where(
      and(
        eq(inviteTokens.userId, userId),
        eq(inviteTokens.status, "active")
      )
    );

  // Generate new token
  const { raw, hash: tokenHash } = generateToken();
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000);

  await db.insert(inviteTokens).values({
    userId,
    tokenHash,
    status: "active",
    expiresAt,
  });

  // Ensure mustChangePassword is set
  await db
    .update(users)
    .set({ mustChangePassword: true, updatedAt: new Date() })
    .where(eq(users.id, userId));

  const inviteUrl = buildInviteUrl(raw);

  revalidatePath("/users");
  revalidatePath(`/users/${userId}`);
  return { success: true, data: { inviteUrl } };
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
): Promise<ActionResult<{ redirectUrl: string }>> {
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
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: false,
        updatedAt: now,
      })
      .where(eq(users.id, record.userId));

    await tx
      .update(inviteTokens)
      .set({
        status: "consumed",
        consumedAt: now,
      })
      .where(eq(inviteTokens.id, record.id));
  });

  return { success: true, data: { redirectUrl: "/login" } };
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
  const tokenResult = await generateInviteToken(input.userId);
  if (!tokenResult.success) {
    return { success: false, error: tokenResult.error };
  }

  const inviteUrl = tokenResult.data.inviteUrl;
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
): Promise<ActionResult<{ emailId: string }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) return { success: false, error: "User not found" };

  // Always generate a fresh token so we have the raw value for the URL.
  // generateInviteToken invalidates any previous active tokens.
  const tokenResult = await generateInviteToken(userId);
  if (!tokenResult.success) {
    return { success: false, error: tokenResult.error };
  }
  const inviteUrl = tokenResult.data.inviteUrl;

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

  return { success: true, data: { emailId: emailResult.data?.id ?? "" } };
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
      // Generate a fresh token for each user
      const tokenResult = await generateInviteToken(user.id);
      if (!tokenResult.success) {
        failed++;
        errors.push({ userId: user.id, email: user.email, error: tokenResult.error });
        continue;
      }

      const emailResult = await sendEmail({
        to: user.email,
        subject: "You're invited to AI Developer Hub",
        react: InviteEmail({
          userName: user.name,
          inviteUrl: tokenResult.data.inviteUrl,
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
