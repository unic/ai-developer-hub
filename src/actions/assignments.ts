"use server";

import { db } from "@/lib/db";
import {
  licenseAssignments,
  accessTiers,
  aiTools,
  users,
} from "@/lib/db/schema";
import { eq, and, count } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { assignmentSchema } from "@/lib/validators";
import type { ActionResult } from "@/types";
import { recordCreation, recordStatusChange } from "@/actions/history";

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
