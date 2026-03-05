"use server";

import { db } from "@/lib/db";
import {
  licenseAssignments,
  accessTiers,
  aiTools,
  users,
  assignmentComments,
} from "@/lib/db/schema";
import { eq, and, count, asc, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth-helpers";
import {
  assignmentSchema,
  updateAssignmentSchema,
  assignmentCommentSchema,
  bulkImportAssignmentRowSchema,
} from "@/lib/validators";
import type { ActionResult, ToolUtilization } from "@/types";
import { encryptApiKey, decryptApiKey } from "@/lib/crypto";
import { recordCreation, recordStatusChange, recordUpdate } from "@/actions/history";

export async function assignLicense(
  input: unknown
): Promise<ActionResult<{ id: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = assignmentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Validation failed" };
  }

  const { userId, toolId, tierId } = parsed.data;

  // Validate user exists and is active
  const user = await db.query.users.findFirst({
    where: and(eq(users.id, userId), eq(users.status, "active")),
  });
  if (!user) return { success: false, error: "User not found or inactive" };

  // Validate tool exists and is active
  const tool = await db.query.aiTools.findFirst({
    where: and(eq(aiTools.id, toolId), eq(aiTools.status, "active")),
  });
  if (!tool) return { success: false, error: "Tool not found or archived" };

  // Validate tier exists, is active, and belongs to the tool
  const tier = await db.query.accessTiers.findFirst({
    where: and(
      eq(accessTiers.id, tierId),
      eq(accessTiers.toolId, toolId),
      eq(accessTiers.isActive, true)
    ),
  });
  if (!tier)
    return { success: false, error: "Tier not found or not available" };

  // FR-006: License capacity check
  if (tool.maxLicenses !== null) {
    const [activeCount] = await db
      .select({ count: count() })
      .from(licenseAssignments)
      .where(
        and(
          eq(licenseAssignments.toolId, toolId),
          eq(licenseAssignments.status, "active")
        )
      );

    // Check if user already has an active assignment (upgrade scenario)
    const existingAssignment = await db.query.licenseAssignments.findFirst({
      where: and(
        eq(licenseAssignments.userId, userId),
        eq(licenseAssignments.toolId, toolId),
        eq(licenseAssignments.status, "active")
      ),
    });

    const effectiveCount = existingAssignment
      ? activeCount.count - 1
      : activeCount.count;

    if (effectiveCount >= tool.maxLicenses) {
      return { success: false, error: "License capacity limit reached" };
    }
  }

  const now = new Date();
  let newAssignmentId: number;

  // Transaction: deactivate existing + create new (for upgrades/downgrades)
  await db.transaction(async (tx) => {
    // Deactivate existing assignment for this user+tool if any
    await tx
      .update(licenseAssignments)
      .set({ status: "inactive", revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(licenseAssignments.userId, userId),
          eq(licenseAssignments.toolId, toolId),
          eq(licenseAssignments.status, "active")
        )
      );

    // Create new assignment with cost snapshot (FR-020)
    const [newAssignment] = await tx
      .insert(licenseAssignments)
      .values({
        userId,
        toolId,
        tierId,
        costAtAssignmentCents: tier.monthlyCostCents,
        status: "active",
        assignedAt: now,
      })
      .returning({ id: licenseAssignments.id });

    newAssignmentId = newAssignment.id;
  });

  await recordCreation(
    "license_assignment",
    newAssignmentId!,
    Number(admin.id)
  );

  revalidatePath("/assignments");
  revalidatePath(`/users/${userId}`);
  revalidatePath(`/tools/${toolId}`);
  return { success: true, data: { id: newAssignmentId! } };
}

export async function revokeLicense(input: {
  id: number;
}): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const assignment = await db.query.licenseAssignments.findFirst({
    where: eq(licenseAssignments.id, input.id),
  });
  if (!assignment) return { success: false, error: "Assignment not found" };
  if (assignment.status !== "active") {
    return { success: false, error: "Assignment is already inactive" };
  }

  const now = new Date();
  await db
    .update(licenseAssignments)
    .set({ status: "inactive", revokedAt: now, updatedAt: now })
    .where(eq(licenseAssignments.id, input.id));

  await recordStatusChange(
    "license_assignment",
    input.id,
    Number(admin.id),
    "active",
    "inactive"
  );

  revalidatePath("/assignments");
  revalidatePath(`/users/${assignment.userId}`);
  revalidatePath(`/tools/${assignment.toolId}`);
  return { success: true, data: undefined };
}

export async function updateAssignment(
  input: unknown
): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = updateAssignmentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Validation failed" };
  }

  const { id, tierId, assignedAt, workspace, apiKey } = parsed.data;

  // Load existing assignment with user and tool relations
  const assignment = await db.query.licenseAssignments.findFirst({
    where: eq(licenseAssignments.id, id),
    with: {
      user: true,
      tool: true,
    },
  });
  if (!assignment) return { success: false, error: "Assignment not found" };
  if (assignment.status !== "active") {
    return { success: false, error: "Cannot edit an inactive assignment" };
  }

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  const updateValues: Record<string, unknown> = {};
  let warning: string | undefined;

  // --- tierId change ---
  if (tierId !== undefined && tierId !== assignment.tierId) {
    // Validate new tier exists, is active, and belongs to the same tool
    const newTier = await db.query.accessTiers.findFirst({
      where: and(
        eq(accessTiers.id, tierId),
        eq(accessTiers.toolId, assignment.toolId),
        eq(accessTiers.isActive, true)
      ),
    });
    if (!newTier) {
      return { success: false, error: "Tier not found or not available for this tool" };
    }

    changes.tierId = { old: assignment.tierId, new: tierId };
    updateValues.tierId = tierId;

    // Also update cost snapshot to the new tier's cost
    changes.costAtAssignmentCents = {
      old: assignment.costAtAssignmentCents,
      new: newTier.monthlyCostCents,
    };
    updateValues.costAtAssignmentCents = newTier.monthlyCostCents;
  }

  // --- assignedAt change ---
  if (assignedAt !== undefined) {
    const newDate = new Date(assignedAt);
    const existingDate = assignment.assignedAt;

    if (newDate.getTime() !== existingDate.getTime()) {
      // Validate not in the future
      if (newDate > new Date()) {
        return { success: false, error: "Assigned date cannot be in the future" };
      }

      // Validate not before user.createdAt
      if (newDate < assignment.user.createdAt) {
        return {
          success: false,
          error: "Assigned date cannot be before the user was created",
        };
      }

      // Validate not before tool.createdAt
      if (newDate < assignment.tool.createdAt) {
        return {
          success: false,
          error: "Assigned date cannot be before the tool was created",
        };
      }

      // Warn if more than 12 months in the past
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
      if (newDate < twelveMonthsAgo) {
        warning = "Assigned date is more than 12 months in the past";
      }

      changes.assignedAt = {
        old: existingDate.toISOString(),
        new: newDate.toISOString(),
      };
      updateValues.assignedAt = newDate;
    }
  }

  // --- apiKey change ---
  if (apiKey !== undefined) {
    if (apiKey === "") {
      // Empty string = clear API key
      changes.apiKeyEncrypted = { old: "[redacted]", new: null };
      updateValues.apiKeyEncrypted = null;
    } else {
      const encrypted = await encryptApiKey(apiKey);
      changes.apiKeyEncrypted = { old: "[redacted]", new: "[redacted]" };
      updateValues.apiKeyEncrypted = encrypted;
    }
  }

  // --- workspace change ---
  if (workspace !== undefined && workspace !== (assignment.workspace ?? "")) {
    changes.workspace = {
      old: assignment.workspace ?? null,
      new: workspace || null,
    };
    updateValues.workspace = workspace || null;
  }

  // No changes detected
  if (Object.keys(changes).length === 0) {
    return { success: true, data: undefined };
  }

  // Apply update
  const now = new Date();
  updateValues.updatedAt = now;

  await db
    .update(licenseAssignments)
    .set(updateValues)
    .where(eq(licenseAssignments.id, id));

  // Record changes in history
  await recordUpdate(
    "license_assignment",
    id,
    Number(admin.id),
    changes
  );

  revalidatePath("/assignments");
  revalidatePath(`/users/${assignment.userId}`);

  return { success: true, data: undefined, warning };
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

      await recordCreation("license_assignment", newAssignment.id, Number(admin.id));
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

// 005-rich-reports: License utilization by tool
export async function getLicenseUtilizationByTool(): Promise<ToolUtilization[]> {
  try {
    const activeTools = await db.query.aiTools.findMany({
      where: eq(aiTools.status, "active"),
    });

    if (activeTools.length === 0) return [];

    const activeAssignmentsList = await db
      .select({
        toolId: licenseAssignments.toolId,
        costAtAssignmentCents: licenseAssignments.costAtAssignmentCents,
      })
      .from(licenseAssignments)
      .where(eq(licenseAssignments.status, "active"));

    // Group by toolId
    const byTool = new Map<
      number,
      { count: number; totalCost: number }
    >();
    for (const a of activeAssignmentsList) {
      const existing = byTool.get(a.toolId) ?? { count: 0, totalCost: 0 };
      existing.count += 1;
      existing.totalCost += a.costAtAssignmentCents;
      byTool.set(a.toolId, existing);
    }

    const result: ToolUtilization[] = activeTools.map((tool) => {
      const stats = byTool.get(tool.id) ?? { count: 0, totalCost: 0 };
      const utilizationPct =
        tool.maxLicenses !== null && tool.maxLicenses > 0
          ? (stats.count / tool.maxLicenses) * 100
          : 0;
      return {
        toolId: tool.id,
        toolName: tool.name,
        vendor: tool.vendor,
        assignedCount: stats.count,
        maxLicenses: tool.maxLicenses,
        utilizationPct,
        expectedMonthlyCents: stats.totalCost,
      };
    });

    return result.sort(
      (a, b) => b.expectedMonthlyCents - a.expectedMonthlyCents
    );
  } catch {
    return [];
  }
}
