/**
 * User write cores (043-mcp-write-tools).
 *
 * Extracted from src/actions/users.ts. Only create / update / deactivate are
 * here — the bulk-import path stays in the action, since it has no MCP caller
 * and its CSV diffing helpers are UI-shaped.
 *
 * There is deliberately NO reactivate core. Reactivation is not the inverse of
 * deactivation in this app: `deactivateUserCore` never clears `passwordHash`,
 * never sets `mustChangePassword`, and never revokes `mcp_oauth_tokens`, while
 * `src/lib/auth.ts` gates password login on `status` alone and
 * `verifyAccessToken` re-reads `status` live against 60-day refresh tokens. So a
 * one-line status flip back to 'active' silently restores an offboarded person's
 * old password AND re-arms every dormant grant they still hold. That belongs to a
 * human in the UI, with credential invalidation in the same transaction.
 */

import { randomBytes } from "crypto";
import { and, count, eq, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import { licenseAssignments, users } from "@/lib/db/schema";
import { recordCreation, recordStatusChange, recordUpdate } from "@/lib/history";
import {
  coreErr,
  coreOk,
  MCP_LAST_ADMIN_MESSAGE,
  MCP_PRIVILEGED_FIELD_MESSAGE,
  MCP_PRIVILEGED_TARGET_MESSAGE,
  MCP_SELF_TARGET_MESSAGE,
  targetMismatchMessage,
  type CoreResult,
  type WriteContext,
} from "@/lib/core/context";
import { updateUserSchema, userSchema } from "@/lib/validators";

export interface CreateUserResult {
  userId: number;
  email: string;
  role: string;
  /** Present only for callers with the `credentials` capability (the UI). */
  inviteUrl: string | null;
}

/**
 * Create a user. The caller supplies the invite minting function so this core
 * stays free of the invite module (and so a caps-reduced caller can decline to
 * mint one at all).
 */
export async function createUserCore(
  ctx: WriteContext,
  input: unknown,
  mintInvite: (userId: number) => Promise<{ inviteUrl: string }>,
): Promise<CoreResult<CreateUserResult>> {
  const parsed = userSchema.safeParse(input);
  if (!parsed.success) {
    return coreErr("Validation failed", {
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    });
  }

  const { name, email, circle, role, discipline, githubUsername, profile } =
    parsed.data;

  // Creating an admin is a privilege grant.
  if (role === "admin" && !ctx.caps.privilegedTargets) {
    return coreErr(MCP_PRIVILEGED_FIELD_MESSAGE, { refusedByCaps: true });
  }

  const normalizedEmail = email.toLowerCase();

  const existing = await db.query.users.findFirst({
    where: eq(users.email, normalizedEmail),
    columns: { id: true },
  });
  if (existing) {
    return coreErr("A user with this email already exists");
  }

  if (!ctx.commit) {
    return coreOk({ userId: 0, email: normalizedEmail, role, inviteUrl: null });
  }

  // Random bytes, so the account cannot be signed into with this value.
  const passwordHash = randomBytes(32).toString("hex");

  const userId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values({
        name,
        email: normalizedEmail,
        passwordHash,
        circle: circle ?? null,
        role,
        discipline,
        githubUsername: githubUsername ?? null,
        profile: profile ?? null,
        mustChangePassword: true,
      })
      .returning({ id: users.id });
    await recordCreation("user", created.id, ctx.actorId, {
      tx,
      source: ctx.source,
    });
    return created.id;
  });

  // The token is minted either way so the account is in exactly the state a
  // UI-created user is in (and so /users' Send-invite affordance works). Only a
  // credentials-capable caller receives the URL — an MCP response must never
  // carry a live /setup-password link into a chat transcript.
  const { inviteUrl } = await mintInvite(userId);

  return coreOk(
    {
      userId,
      email: normalizedEmail,
      role,
      inviteUrl: ctx.caps.credentials ? inviteUrl : null,
    },
    ["/users"],
  );
}

export interface UpdateUserResult {
  userId: number;
  email: string;
  changedFields: string[];
}

export async function updateUserCore(
  ctx: WriteContext,
  input: unknown,
): Promise<CoreResult<UpdateUserResult>> {
  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success) return coreErr("Validation failed");

  const { id, ...updates } = parsed.data;

  const existing = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!existing) return coreErr("User not found");

  const echo = checkUserEmailEcho(ctx, existing.email);
  if (echo) return echo;

  const guard = checkTargetAllowed(ctx, existing);
  if (guard) return guard;

  // `role` confers privilege; `email` is where every credential-recovery path
  // mails its link (resetUserPassword / sendInviteEmail both send to the CURRENT
  // users.email), so rewriting it is an account-takeover primitive that the
  // email echo cannot defend against — the echo matches the old address.
  if (updates.role !== undefined && !ctx.caps.privilegedTargets) {
    return coreErr(MCP_PRIVILEGED_FIELD_MESSAGE, { refusedByCaps: true });
  }
  if (updates.email !== undefined && !ctx.caps.privilegedTargets) {
    return coreErr(MCP_PRIVILEGED_FIELD_MESSAGE, { refusedByCaps: true });
  }

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  const values: Record<string, unknown> = { updatedAt: new Date() };

  if (updates.name !== undefined && updates.name !== existing.name) {
    changes.name = { old: existing.name, new: updates.name };
    values.name = updates.name;
  }
  if (updates.email !== undefined) {
    const normalizedEmail = updates.email.toLowerCase();
    if (normalizedEmail !== existing.email) {
      const emailExists = await db.query.users.findFirst({
        where: and(eq(users.email, normalizedEmail), ne(users.id, id)),
        columns: { id: true },
      });
      if (emailExists) return coreErr("Email already in use");
      changes.email = { old: existing.email, new: normalizedEmail };
      values.email = normalizedEmail;
    }
  }
  if (updates.circle !== undefined && updates.circle !== existing.circle) {
    changes.circle = { old: existing.circle, new: updates.circle };
    values.circle = updates.circle;
  }
  if (updates.role !== undefined && updates.role !== existing.role) {
    changes.role = { old: existing.role, new: updates.role };
    values.role = updates.role;
  }
  if (
    updates.discipline !== undefined &&
    updates.discipline !== existing.discipline
  ) {
    changes.discipline = { old: existing.discipline, new: updates.discipline };
    values.discipline = updates.discipline;
  }
  if (
    updates.githubUsername !== undefined &&
    updates.githubUsername !== existing.githubUsername
  ) {
    changes.githubUsername = {
      old: existing.githubUsername,
      new: updates.githubUsername,
    };
    values.githubUsername = updates.githubUsername;
  }
  if (updates.profile !== undefined && updates.profile !== existing.profile) {
    changes.profile = { old: existing.profile, new: updates.profile };
    values.profile = updates.profile;
  }

  const changedFields = Object.keys(changes);
  const result: UpdateUserResult = {
    userId: id,
    email: (values.email as string | undefined) ?? existing.email,
    changedFields,
  };

  if (changedFields.length === 0) return coreOk(result, [], { noop: true });
  if (!ctx.commit) return coreOk(result);

  await db.transaction(async (tx) => {
    await tx.update(users).set(values).where(eq(users.id, id));
    await recordUpdate("user", id, ctx.actorId, changes, {
      tx,
      source: ctx.source,
    });
  });

  return coreOk(result, ["/users", `/users/${id}`]);
}

export interface RevokedSeat {
  assignmentId: number;
  toolId: number;
  toolName: string;
  tierId: number;
  tierName: string;
  monthlyCostCents: number;
}

export interface DeactivateUserResult {
  userId: number;
  email: string;
  revokedCount: number;
  monthlyReleasedCents: number;
  revoked: RevokedSeat[];
}

export async function deactivateUserCore(
  ctx: WriteContext,
  input: { id: number },
): Promise<CoreResult<DeactivateUserResult>> {
  const existing = await db.query.users.findFirst({
    where: eq(users.id, input.id),
  });
  if (!existing) return coreErr("User not found");

  const echo = checkUserEmailEcho(ctx, existing.email);
  if (echo) return echo;

  const guard = checkTargetAllowed(ctx, existing);
  if (guard) return guard;

  // Identity-independent, so it also protects a caller with no bound self.
  if (existing.role === "admin") {
    const [activeAdmins] = await db
      .select({ count: count() })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.status, "active")));
    if (activeAdmins.count <= 1) {
      return coreErr(MCP_LAST_ADMIN_MESSAGE);
    }
  }

  const activeAssignments = await db.query.licenseAssignments.findMany({
    where: and(
      eq(licenseAssignments.userId, input.id),
      eq(licenseAssignments.status, "active"),
    ),
    with: {
      tool: { columns: { id: true, name: true } },
      tier: { columns: { id: true, name: true } },
    },
  });

  const revoked: RevokedSeat[] = activeAssignments.map((a) => ({
    assignmentId: a.id,
    toolId: a.tool.id,
    toolName: a.tool.name,
    tierId: a.tier.id,
    tierName: a.tier.name,
    monthlyCostCents: a.costAtAssignmentCents,
  }));

  const result: DeactivateUserResult = {
    userId: input.id,
    email: existing.email,
    revokedCount: revoked.length,
    monthlyReleasedCents: revoked.reduce((s, r) => s + r.monthlyCostCents, 0),
    revoked,
  };

  if (existing.status !== "active") {
    return coreOk({ ...result, revokedCount: 0, revoked: [] }, [], {
      noop: true,
    });
  }
  if (!ctx.commit) return coreOk(result);

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ status: "inactive", updatedAt: now })
      .where(eq(users.id, input.id));

    if (activeAssignments.length > 0) {
      await tx
        .update(licenseAssignments)
        .set({ status: "inactive", revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(licenseAssignments.userId, input.id),
            eq(licenseAssignments.status, "active"),
          ),
        );
    }

    // Inside the transaction now (the action recorded this after it committed).
    await recordStatusChange(
      "user",
      input.id,
      ctx.actorId,
      "active",
      "inactive",
      { tx, source: ctx.source },
    );

    // The cascade wrote NO audit rows at all before. Each carries a full
    // snapshot, because revokedAt alone cannot tell a reviewer which tools the
    // person held — and nothing restores them.
    for (const seat of revoked) {
      await recordUpdate(
        "license_assignment",
        seat.assignmentId,
        ctx.actorId,
        {
          status: {
            old: {
              status: "active",
              toolId: seat.toolId,
              toolName: seat.toolName,
              tierId: seat.tierId,
              tierName: seat.tierName,
              costAtAssignmentCents: seat.monthlyCostCents,
            },
            new: { status: "inactive", reason: "user_deactivated" },
          },
        },
        { tx, source: ctx.source },
      );
    }
  });

  return coreOk(result, [
    "/users",
    `/users/${input.id}`,
    "/assignments",
    "/reports",
  ]);
}

// ---- Guards ----

function checkUserEmailEcho(
  ctx: WriteContext,
  actual: string,
): CoreResult<never> | null {
  const expected = ctx.expect?.userEmail;
  if (expected === undefined) return null;
  if (expected.trim().toLowerCase() === actual.trim().toLowerCase()) return null;
  return coreErr(targetMismatchMessage("expectedEmail", expected, actual));
}

function checkTargetAllowed(
  ctx: WriteContext,
  target: { id: number; role: string; isAgent: boolean },
): CoreResult<never> | null {
  if (ctx.caps.privilegedTargets) return null;
  if (target.id === ctx.actorId) {
    return coreErr(MCP_SELF_TARGET_MESSAGE, { refusedByCaps: true });
  }
  if (target.role === "admin" || target.isAgent) {
    return coreErr(MCP_PRIVILEGED_TARGET_MESSAGE, { refusedByCaps: true });
  }
  return null;
}
