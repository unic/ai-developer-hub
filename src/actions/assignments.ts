"use server";

import { db } from "@/lib/db";
import {
  licenseAssignments,
  accessTiers,
  aiTools,
  users,
  assignmentComments,
} from "@/lib/db/schema";
import { eq, and, count, asc, inArray, isNull, lte, gt, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth-helpers";
import {
  assignmentCommentSchema,
  bulkImportAssignmentRowSchema,
} from "@/lib/validators";
import type { ActionResult } from "@/types";
import { encryptApiKey, decryptApiKey } from "@/lib/crypto";
import { recordCreation } from "@/lib/history";
import { uiContext, type CoreResult } from "@/lib/core/context";
import {
  assignLicenseCore,
  revokeLicenseCore,
  updateAssignmentCore,
} from "@/lib/core/assignments";

/**
 * Replay a core's revalidation list and collapse its result into the
 * `ActionResult` shape the UI already consumes (043-mcp-write-tools).
 *
 * `noopError` preserves the pre-refactor UI behavior for the two operations that
 * surfaced "already inactive" as an error toast. The MCP adapter maps the same
 * no-op to a SUCCESS payload instead — an `isError` there would contradict
 * `idempotentHint: true` and teach an agent that a committed-but-unacknowledged
 * call had failed.
 */
function fromCore<T>(
  result: CoreResult<T>,
  noopError?: string,
): ActionResult<T> {
  if (!result.ok) {
    return {
      success: false,
      error: result.error,
      ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
    };
  }
  if (result.noop && noopError) {
    return { success: false, error: noopError };
  }
  for (const path of result.revalidate) revalidatePath(path);
  return {
    success: true,
    data: result.data,
    ...(result.warning ? { warning: result.warning } : {}),
  };
}

export async function assignLicense(
  input: unknown
): Promise<ActionResult<{ id: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const result = await assignLicenseCore(uiContext(Number(admin.id)), input);
  if (!result.ok) return { success: false, error: result.error };
  for (const path of result.revalidate) revalidatePath(path);
  return { success: true, data: { id: result.data.assignmentId } };
}

export async function revokeLicense(input: {
  id: number;
}): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const result = await revokeLicenseCore(uiContext(Number(admin.id)), input);
  const mapped = fromCore(result, "Assignment is already inactive");
  return mapped.success
    ? { success: true, data: undefined }
    : { success: false, error: mapped.error };
}

export async function updateAssignment(
  input: unknown
): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const result = await updateAssignmentCore(uiContext(Number(admin.id)), input);
  if (!result.ok) return { success: false, error: result.error };
  for (const path of result.revalidate) revalidatePath(path);
  return { success: true, data: undefined, ...(result.warning ? { warning: result.warning } : {}) };
}


export async function bulkImportAssignments(input: {
  assignments: unknown[];
}): Promise<
  ActionResult<{
    imported: number;
    failed: number;
    errors: Array<{ row: number; email: string; error: string }>;
  }>
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  // Validate all rows first
  const validatedRows: Array<{
    index: number;
    data: { email: string; tool: string; tier: string; workspace?: string; apiKey?: string; assignedAt: string };
  }> = [];
  const errors: Array<{ row: number; email: string; error: string }> = [];

  for (let i = 0; i < input.assignments.length; i++) {
    const parsed = bulkImportAssignmentRowSchema.safeParse(input.assignments[i]);
    if (!parsed.success) {
      const raw = input.assignments[i];
      errors.push({
        row: i + 1,
        email: (typeof raw === "object" && raw !== null && "email" in raw ? String((raw as Record<string, unknown>).email) : "unknown"),
        error: parsed.error.issues[0]?.message ?? "Validation failed",
      });
    } else {
      validatedRows.push({ index: i, data: parsed.data });
    }
  }

  if (validatedRows.length === 0) {
    revalidatePath("/assignments");
    revalidatePath("/reports");
    return { success: true, data: { imported: 0, failed: errors.length, errors } };
  }

  // Pre-fetch all lookup data in bulk (4 queries instead of 4N)
  const uniqueEmails = [...new Set(validatedRows.map((r) => r.data.email.toLowerCase()))];
  const [allActiveUsers, allActiveTools, allActiveTiers] = await Promise.all([
    db.select().from(users).where(and(inArray(users.email, uniqueEmails), eq(users.status, "active"))),
    db.select().from(aiTools).where(eq(aiTools.status, "active")),
    db.select().from(accessTiers).where(eq(accessTiers.isActive, true)),
  ]);

  // Build lookup maps
  const userByEmail = new Map(allActiveUsers.map((u) => [u.email.toLowerCase(), u]));
  const toolByName = new Map(allActiveTools.map((t) => [t.name.toLowerCase(), t]));
  const tierByKey = new Map(allActiveTiers.map((t) => [`${t.toolId}:${t.name.toLowerCase()}`, t]));

  // Scope assignment duplicate check to relevant users/tools only
  const relevantUserIds = allActiveUsers.map((u) => u.id);
  const toolNamesInBatch = [...new Set(validatedRows.map((r) => r.data.tool.toLowerCase()))];
  const relevantToolIds = allActiveTools
    .filter((t) => toolNamesInBatch.includes(t.name.toLowerCase()))
    .map((t) => t.id);

  let allActiveAssignments: Array<{ userId: number; toolId: number }> = [];
  if (relevantUserIds.length > 0 && relevantToolIds.length > 0) {
    allActiveAssignments = await db
      .select({ userId: licenseAssignments.userId, toolId: licenseAssignments.toolId })
      .from(licenseAssignments)
      .where(
        and(
          eq(licenseAssignments.status, "active"),
          inArray(licenseAssignments.userId, relevantUserIds),
          inArray(licenseAssignments.toolId, relevantToolIds)
        )
      );
  }
  const activeAssignmentSet = new Set(allActiveAssignments.map((a) => `${a.userId}:${a.toolId}`));

  // Pre-compute license counts per tool for capacity checks
  const licenseCounts = new Map<number, number>();
  for (const toolId of relevantToolIds) {
    const [result] = await db
      .select({ count: count() })
      .from(licenseAssignments)
      .where(and(eq(licenseAssignments.toolId, toolId), eq(licenseAssignments.status, "active")));
    licenseCounts.set(toolId, result.count);
  }

  let imported = 0;

  for (const { index, data } of validatedRows) {
    const { email, tool: toolName, tier: tierName, workspace, apiKey, assignedAt } = data;

    const user = userByEmail.get(email.toLowerCase());
    if (!user) {
      errors.push({ row: index + 1, email, error: "User not found or inactive" });
      continue;
    }

    const tool = toolByName.get(toolName.toLowerCase());
    if (!tool) {
      errors.push({ row: index + 1, email, error: `Tool "${toolName}" not found` });
      continue;
    }

    const tier = tierByKey.get(`${tool.id}:${tierName.toLowerCase()}`);
    if (!tier) {
      errors.push({ row: index + 1, email, error: `Tier "${tierName}" not found for ${tool.name}` });
      continue;
    }

    if (activeAssignmentSet.has(`${user.id}:${tool.id}`)) {
      errors.push({ row: index + 1, email, error: `Already has active assignment for ${tool.name}` });
      continue;
    }

    // License capacity check
    if (tool.maxLicenses !== null) {
      const currentCount = licenseCounts.get(tool.id) ?? 0;
      if (currentCount >= tool.maxLicenses) {
        errors.push({ row: index + 1, email, error: `License capacity reached for ${tool.name}` });
        continue;
      }
    }

    try {
      const apiKeyEncrypted = apiKey ? await encryptApiKey(apiKey) : null;

      const [newAssignment] = await db
        .insert(licenseAssignments)
        .values({
          userId: user.id,
          toolId: tool.id,
          tierId: tier.id,
          costAtAssignmentCents: tier.monthlyCostCents,
          status: "active",
          assignedAt: new Date(assignedAt),
          workspace: workspace ?? null,
          apiKeyEncrypted,
        })
        .returning({ id: licenseAssignments.id });

      await recordCreation(
        "license_assignment",
        newAssignment.id,
        Number(admin.id),
        { source: "ui" },
      );
      // Track newly created assignment to prevent duplicates within the same batch
      activeAssignmentSet.add(`${user.id}:${tool.id}`);
      // Update license count for capacity tracking within batch
      licenseCounts.set(tool.id, (licenseCounts.get(tool.id) ?? 0) + 1);
      imported++;
    } catch (err) {
      errors.push({
        row: index + 1,
        email,
        error: err instanceof Error ? err.message : "Database insert failed",
      });
    }
  }

  revalidatePath("/assignments");
  revalidatePath("/reports");
  return {
    success: true,
    data: { imported, failed: errors.length, errors },
  };
}

export async function revealApiKey(
  assignmentId: number
): Promise<ActionResult<{ plaintext: string }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const assignment = await db.query.licenseAssignments.findFirst({
    where: eq(licenseAssignments.id, assignmentId),
  });
  if (!assignment) return { success: false, error: "Assignment not found" };

  if (!assignment.apiKeyEncrypted) {
    return { success: false, error: "No API key stored" };
  }

  try {
    const plaintext = await decryptApiKey(assignment.apiKeyEncrypted);
    return { success: true, data: { plaintext } };
  } catch {
    return { success: false, error: "Unable to decrypt stored API key. Please contact support." };
  }
}

export async function addAssignmentComment(
  input: unknown
): Promise<ActionResult<{ id: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = assignmentCommentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Validation failed" };
  }

  const { assignmentId, body } = parsed.data;

  // Verify assignment exists
  const assignment = await db.query.licenseAssignments.findFirst({
    where: eq(licenseAssignments.id, assignmentId),
  });
  if (!assignment) return { success: false, error: "Assignment not found" };

  const [newComment] = await db
    .insert(assignmentComments)
    .values({
      assignmentId,
      authorId: Number(admin.id),
      body,
    })
    .returning({ id: assignmentComments.id });

  revalidatePath(`/assignments/${assignmentId}`);
  return { success: true, data: { id: newComment.id } };
}

export async function getAssignmentComments(assignmentId: number) {
  const session = await auth();
  if (!session?.user) return [];

  return db.query.assignmentComments.findMany({
    where: eq(assignmentComments.assignmentId, assignmentId),
    orderBy: [asc(assignmentComments.createdAt)],
    with: {
      author: true,
    },
  });
}

export async function getAssignmentById(id: number) {
  const session = await auth();
  if (!session?.user) return null;

  const assignment = await db.query.licenseAssignments.findFirst({
    where: eq(licenseAssignments.id, id),
    with: {
      user: true,
      tool: true,
      tier: true,
    },
  });

  if (!assignment) return null;

  // Viewers can only see their own assignments
  if (
    session.user.role !== "admin" &&
    assignment.userId !== Number(session.user.id)
  ) {
    return null;
  }

  return assignment;
}

// Read helpers
export async function getAssignments() {
  return db.query.licenseAssignments.findMany({
    with: {
      user: true,
      tool: true,
      tier: true,
    },
    orderBy: (a, { desc }) => [desc(a.assignedAt)],
  });
}

export async function getAssignmentsForUser(userId: number) {
  return db.query.licenseAssignments.findMany({
    where: eq(licenseAssignments.userId, userId),
    with: {
      user: true,
      tool: true,
      tier: true,
    },
    orderBy: (a, { desc }) => [desc(a.assignedAt)],
  });
}

/**
 * Snapshot of assignments active "as of" a past moment.
 * An assignment counts as active iff it was assigned before/at the cutoff
 * and not yet revoked at the cutoff.
 */
export async function getAssignmentSnapshotAt(asOf: Date): Promise<
  Array<{
    id: number;
    toolId: number;
    userId: number;
    costAtAssignmentCents: number;
  }>
> {
  return db
    .select({
      id: licenseAssignments.id,
      toolId: licenseAssignments.toolId,
      userId: licenseAssignments.userId,
      costAtAssignmentCents: licenseAssignments.costAtAssignmentCents,
    })
    .from(licenseAssignments)
    .where(
      and(
        lte(licenseAssignments.assignedAt, asOf),
        or(
          isNull(licenseAssignments.revokedAt),
          gt(licenseAssignments.revokedAt, asOf)
        )
      )
    );
}
