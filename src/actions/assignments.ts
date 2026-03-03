"use server";

import { db } from "@/lib/db";
import {
  licenseAssignments,
  accessTiers,
  aiTools,
  users,
  assignmentComments,
} from "@/lib/db/schema";
import { eq, and, count, asc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  assignmentSchema,
  updateAssignmentSchema,
  assignmentCommentSchema,
} from "@/lib/validators";
import type { ActionResult } from "@/types";
import { encryptApiKey, decryptApiKey } from "@/lib/crypto";
import { recordCreation, recordStatusChange, recordUpdate } from "@/actions/history";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") return null;
  return session.user;
}

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
    const encrypted = encryptApiKey(apiKey);
    changes.apiKeyEncrypted = { old: "[redacted]", new: "[redacted]" };
    updateValues.apiKeyEncrypted = encrypted;
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

  const plaintext = decryptApiKey(assignment.apiKeyEncrypted);
  return { success: true, data: { plaintext } };
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
