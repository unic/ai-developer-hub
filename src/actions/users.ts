"use server";

import { db } from "@/lib/db";
import { users, licenseAssignments } from "@/lib/db/schema";
import { eq, and, count, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { randomBytes } from "crypto";
import {
  userSchema,
  updateUserSchema,
  bulkImportUserSchema,
} from "@/lib/validators";
import { createInviteTokenForUser } from "@/actions/invite";
import type { ActionResult, User, BulkImportResult, ExistingUserFields } from "@/types";
import { normalizeField } from "@/lib/utils";
import {
  recordCreation,
  recordUpdate,
  recordStatusChange,
} from "@/actions/history";

export async function createUser(
  input: unknown
): Promise<ActionResult<{ id: number; inviteUrl: string }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = userSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  const { name, email, circle, role, githubUsername, profile } = parsed.data;

  // Check email uniqueness
  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (existing) {
    return { success: false, error: "A user with this email already exists" };
  }

  // Set passwordHash to random bytes — user cannot sign in with this
  const passwordHash = randomBytes(32).toString("hex");

  const [user] = await db
    .insert(users)
    .values({
      name,
      email,
      passwordHash,
      circle: circle ?? null,
      role,
      githubUsername: githubUsername ?? null,
      profile: profile ?? null,
      mustChangePassword: true,
    })
    .returning({ id: users.id });

  await recordCreation("user", user.id, Number(admin.id));

  // Generate invite token
  const { inviteUrl } = await createInviteTokenForUser(user.id);

  revalidatePath("/users");
  return { success: true, data: { id: user.id, inviteUrl } };
}

export async function updateUser(
  input: unknown
): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Validation failed" };
  }

  const { id, ...updates } = parsed.data;

  const existing = await db.query.users.findFirst({
    where: eq(users.id, id),
  });
  if (!existing) return { success: false, error: "User not found" };

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  const values: Record<string, unknown> = { updatedAt: new Date() };

  if (updates.name !== undefined && updates.name !== existing.name) {
    changes.name = { old: existing.name, new: updates.name };
    values.name = updates.name;
  }
  if (updates.email !== undefined && updates.email !== existing.email) {
    const emailExists = await db.query.users.findFirst({
      where: eq(users.email, updates.email),
    });
    if (emailExists) {
      return { success: false, error: "Email already in use" };
    }
    changes.email = { old: existing.email, new: updates.email };
    values.email = updates.email;
  }
  if (
    updates.circle !== undefined &&
    updates.circle !== existing.circle
  ) {
    changes.circle = { old: existing.circle, new: updates.circle };
    values.circle = updates.circle;
  }
  if (updates.role !== undefined && updates.role !== existing.role) {
    changes.role = { old: existing.role, new: updates.role };
    values.role = updates.role;
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
  if (
    updates.profile !== undefined &&
    updates.profile !== existing.profile
  ) {
    changes.profile = {
      old: existing.profile,
      new: updates.profile,
    };
    values.profile = updates.profile;
  }

  if (Object.keys(changes).length > 0) {
    await db.update(users).set(values).where(eq(users.id, id));
    await recordUpdate("user", id, Number(admin.id), changes);
  }

  revalidatePath("/users");
  revalidatePath(`/users/${id}`);
  return { success: true, data: undefined };
}

export async function deactivateUser(input: {
  id: number;
}): Promise<ActionResult<{ revokedCount: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const existing = await db.query.users.findFirst({
    where: eq(users.id, input.id),
  });
  if (!existing) return { success: false, error: "User not found" };
  if (existing.status !== "active") {
    return { success: false, error: "User is already inactive" };
  }

  // Transaction: deactivate user + revoke all active assignments (FR-007)
  const now = new Date();
  const activeAssignments = await db.query.licenseAssignments.findMany({
    where: and(
      eq(licenseAssignments.userId, input.id),
      eq(licenseAssignments.status, "active")
    ),
  });

  await db.transaction(async (tx) => {
    // Deactivate user
    await tx
      .update(users)
      .set({ status: "inactive", updatedAt: now })
      .where(eq(users.id, input.id));

    // Revoke all active license assignments
    if (activeAssignments.length > 0) {
      await tx
        .update(licenseAssignments)
        .set({ status: "inactive", revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(licenseAssignments.userId, input.id),
            eq(licenseAssignments.status, "active")
          )
        );
    }
  });

  await recordStatusChange(
    "user",
    input.id,
    Number(admin.id),
    "active",
    "inactive"
  );

  revalidatePath("/users");
  revalidatePath(`/users/${input.id}`);
  revalidatePath("/assignments");
  return { success: true, data: { revokedCount: activeAssignments.length } };
}

/** Compare CSV row fields against existing user, return changed fields with old/new values.
 *  Only considers a field changed if the CSV explicitly provides a value (not undefined). */
function computeUserDiff(
  row: { name: string; circle?: string; role?: string; githubUsername?: string; profile?: string },
  existing: { name: string; circle: string | null; role: string; githubUsername: string | null; profile: string | null }
): Record<string, { old: unknown; new: unknown }> {
  const changes: Record<string, { old: unknown; new: unknown }> = {};

  // name is always required
  if (row.name !== existing.name) {
    changes.name = { old: existing.name, new: row.name };
  }
  // Optional fields: only update when CSV explicitly provides a value
  if (row.circle !== undefined) {
    const newCircle = normalizeField(row.circle);
    if (newCircle !== existing.circle) {
      changes.circle = { old: existing.circle, new: newCircle };
    }
  }
  if (row.role !== undefined && row.role !== existing.role) {
    changes.role = { old: existing.role, new: row.role };
  }
  if (row.githubUsername !== undefined) {
    const newGithubUsername = normalizeField(row.githubUsername);
    if (newGithubUsername !== existing.githubUsername) {
      changes.githubUsername = { old: existing.githubUsername, new: newGithubUsername };
    }
  }
  if (row.profile !== undefined) {
    const newProfile = normalizeField(row.profile);
    if (newProfile !== existing.profile) {
      changes.profile = { old: existing.profile, new: newProfile };
    }
  }

  return changes;
}

/** Look up existing users by email for preview labeling */
export async function checkExistingUsers(input: {
  emails: string[];
}): Promise<ActionResult<Record<string, ExistingUserFields>>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  if (input.emails.length === 0) {
    return { success: true, data: {} };
  }

  const lowerEmails = input.emails.map((e) => e.toLowerCase());
  const found = await db.query.users.findMany({
    where: inArray(sql`lower(${users.email})`, lowerEmails),
  });

  const map: Record<string, ExistingUserFields> = {};
  for (const u of found) {
    map[u.email.toLowerCase()] = {
      name: u.name,
      circle: u.circle,
      role: u.role,
      githubUsername: u.githubUsername,
      profile: u.profile,
    };
  }

  return { success: true, data: map };
}

export async function bulkImportUsers(input: {
  users: unknown[];
}): Promise<ActionResult<BulkImportResult>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const errors: Array<{ row: number; email: string; error: string }> = [];
  const inviteLinks: Array<{ name: string; email: string; inviteUrl: string }> = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  // Batch-query all existing users upfront to avoid N+1 (case-insensitive)
  const allEmails = input.users
    .map((u) => (u as { email?: string })?.email?.toLowerCase())
    .filter((e): e is string => !!e);
  const existingUsers = allEmails.length > 0
    ? await db.query.users.findMany({ where: inArray(sql`lower(${users.email})`, allEmails) })
    : [];
  const existingMap = new Map(existingUsers.map((u) => [u.email.toLowerCase(), u]));

  // Track emails seen in this import to detect duplicates within the file
  const seenEmails = new Set<string>();

  for (let i = 0; i < input.users.length; i++) {
    const parsed = bulkImportUserSchema.safeParse(input.users[i]);
    if (!parsed.success) {
      errors.push({
        row: i + 1,
        email: (input.users[i] as { email?: string })?.email ?? "unknown",
        error: parsed.error.issues[0]?.message ?? "Validation failed",
      });
      continue;
    }

    const { name, email, circle, role, githubUsername, profile } = parsed.data;
    const lowerEmail = email.toLowerCase();

    // Detect duplicate emails within the same file
    if (seenEmails.has(lowerEmail)) {
      errors.push({ row: i + 1, email, error: "Duplicate email in file" });
      continue;
    }
    seenEmails.add(lowerEmail);

    try {
      const existing = existingMap.get(lowerEmail);

      if (existing) {
        // Upsert: update existing user (never touch password or status)
        const diff = computeUserDiff(
          { name, circle, role, githubUsername, profile },
          existing
        );

        if (Object.keys(diff).length === 0) {
          skipped++;
          continue;
        }

        const values: Record<string, unknown> = { updatedAt: new Date() };
        for (const [field, change] of Object.entries(diff)) {
          values[field] = change.new;
        }

        await db.update(users).set(values).where(eq(users.id, existing.id));
        await recordUpdate("user", existing.id, Number(admin.id), diff);
        updated++;
      } else {
        // Create new user with random password (unusable — user must use invite link)
        const passwordHash = randomBytes(32).toString("hex");
        const [user] = await db
          .insert(users)
          .values({
            name,
            email,
            passwordHash,
            circle: circle ?? null,
            role: role ?? "viewer",
            githubUsername: githubUsername ?? null,
            profile: profile ?? null,
            mustChangePassword: true,
          })
          .returning({ id: users.id });

        await recordCreation("user", user.id, Number(admin.id));

        // Generate invite token for the new user
        const { inviteUrl } = await createInviteTokenForUser(user.id);
        inviteLinks.push({ name, email, inviteUrl });

        created++;
      }
    } catch (err) {
      errors.push({
        row: i + 1,
        email,
        error:
          err instanceof Error ? err.message : "Database operation failed",
      });
    }
  }

  revalidatePath("/users");
  return {
    success: true,
    data: {
      created,
      updated,
      skipped,
      failed: errors.length,
      errors,
      inviteLinks: inviteLinks.length > 0 ? inviteLinks : undefined,
    },
  };
}

// Read helpers
export async function getUsers(): Promise<User[]> {
  return db.query.users.findMany({
    orderBy: (u, { asc }) => [asc(u.name)],
  });
}

export async function getUserById(id: number) {
  return db.query.users.findFirst({
    where: eq(users.id, id),
  });
}

export async function getUserAssignments(userId: number) {
  return db.query.licenseAssignments.findMany({
    where: eq(licenseAssignments.userId, userId),
    with: {
      tool: true,
      tier: true,
    },
    orderBy: (a, { desc }) => [desc(a.assignedAt)],
  });
}
