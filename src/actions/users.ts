"use server";

import { db } from "@/lib/db";
import { users, licenseAssignments } from "@/lib/db/schema";
import { eq, and, count, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { randomBytes } from "crypto";
import { bulkImportUserSchema } from "@/lib/validators";
import { createInviteTokenForUser } from "@/lib/invite";
import type { ActionResult, User, BulkImportResult, ExistingUserFields } from "@/types";
import { normalizeField } from "@/lib/utils";
import { recordCreation, recordUpdate } from "@/lib/history";
import { uiContext } from "@/lib/core/context";
import {
  createUserCore,
  deactivateUserCore,
  updateUserCore,
} from "@/lib/core/users";

export async function createUser(
  input: unknown
): Promise<ActionResult<{ id: number; inviteUrl: string }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const result = await createUserCore(
    uiContext(Number(admin.id)),
    input,
    createInviteTokenForUser
  );
  if (!result.ok) {
    return {
      success: false,
      error: result.error,
      ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
    };
  }
  for (const path of result.revalidate) revalidatePath(path);
  return {
    success: true,
    // UI_CAPS includes `credentials`, so the core always returns the URL here.
    data: { id: result.data.userId, inviteUrl: result.data.inviteUrl! },
  };
}

export async function updateUser(
  input: unknown
): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const result = await updateUserCore(uiContext(Number(admin.id)), input);
  if (!result.ok) return { success: false, error: result.error };
  for (const path of result.revalidate) revalidatePath(path);
  return { success: true, data: undefined };
}

export async function deactivateUser(input: {
  id: number;
}): Promise<ActionResult<{ revokedCount: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const result = await deactivateUserCore(uiContext(Number(admin.id)), input);
  if (!result.ok) return { success: false, error: result.error };
  // Preserved pre-refactor UI behavior: this surfaced as an error toast.
  if (result.noop) return { success: false, error: "User is already inactive" };
  for (const path of result.revalidate) revalidatePath(path);
  return { success: true, data: { revokedCount: result.data.revokedCount } };
}


/** Compare CSV row fields against existing user, return changed fields with old/new values.
 *  Only considers a field changed if the CSV explicitly provides a value (not undefined). */
function computeUserDiff(
  row: {
    name: string;
    circle?: string;
    role?: string;
    discipline?: string;
    githubUsername?: string;
    profile?: string;
  },
  existing: {
    name: string;
    circle: string | null;
    role: string;
    discipline: string;
    githubUsername: string | null;
    profile: string | null;
  }
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
  if (row.discipline !== undefined && row.discipline !== existing.discipline) {
    changes.discipline = { old: existing.discipline, new: row.discipline };
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
      discipline: u.discipline,
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

    const { name, email, circle, role, discipline, githubUsername, profile } =
      parsed.data;
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
        // Upsert: update existing user (never touch password or status).
        // discipline is omitted from the diff input when the CSV did not
        // supply it, so the existing discipline is preserved on upsert.
        const diff = computeUserDiff(
          { name, circle, role, discipline, githubUsername, profile },
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
        await recordUpdate("user", existing.id, Number(admin.id), diff, {
          source: "ui",
        });
        updated++;
      } else {
        // Create new user with random password (unusable — user must use invite link)
        const passwordHash = randomBytes(32).toString("hex");
        const [user] = await db
          .insert(users)
          .values({
            name,
            email: lowerEmail,
            passwordHash,
            circle: circle ?? null,
            role: role ?? "viewer",
            // New rows default to "developer" when CSV omits the column,
            // matching the DB default but explicit for traceability.
            discipline: discipline ?? "developer",
            githubUsername: githubUsername ?? null,
            profile: profile ?? null,
            mustChangePassword: true,
          })
          .returning({ id: users.id });

        await recordCreation("user", user.id, Number(admin.id), {
          source: "ui",
        });

        // Generate invite token for the new user
        const { inviteUrl } = await createInviteTokenForUser(user.id);
        inviteLinks.push({ name, email: lowerEmail, inviteUrl });

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
