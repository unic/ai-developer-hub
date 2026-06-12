"use server";

import { db } from "@/lib/db";
import { aiTools, accessTiers, licenseAssignments } from "@/lib/db/schema";
import { eq, and, count } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import {
  toolSchema,
  tierSchema,
  updateToolSchema,
  updateTierSchema,
} from "@/lib/validators";
import type { ActionResult, AiTool, AccessTier } from "@/types";
import {
  recordCreation,
  recordUpdate,
  recordStatusChange,
} from "@/actions/history";

// ---- Tool Actions ----

export async function createTool(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = toolSchema.safeParse(input);
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

  const { name, vendor, description, maxLicenses } = parsed.data;

  const [tool] = await db
    .insert(aiTools)
    .values({
      name,
      vendor,
      description: description ?? null,
      maxLicenses: maxLicenses ?? null,
    })
    .returning({ id: aiTools.id });

  await recordCreation("ai_tool", tool.id, Number(admin.id));

  revalidatePath("/tools");
  return { success: true, data: { id: tool.id } };
}

export async function updateTool(input: unknown): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = updateToolSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Validation failed" };
  }

  const { id, ...updates } = parsed.data;

  const existing = await db.query.aiTools.findFirst({
    where: eq(aiTools.id, id),
  });
  if (!existing) return { success: false, error: "Tool not found" };

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  const values: Record<string, unknown> = { updatedAt: new Date() };

  if (updates.name !== undefined && updates.name !== existing.name) {
    changes.name = { old: existing.name, new: updates.name };
    values.name = updates.name;
  }
  if (updates.vendor !== undefined && updates.vendor !== existing.vendor) {
    changes.vendor = { old: existing.vendor, new: updates.vendor };
    values.vendor = updates.vendor;
  }
  if (
    updates.description !== undefined &&
    updates.description !== existing.description
  ) {
    changes.description = {
      old: existing.description,
      new: updates.description,
    };
    values.description = updates.description;
  }
  if (
    updates.maxLicenses !== undefined &&
    updates.maxLicenses !== existing.maxLicenses
  ) {
    changes.maxLicenses = {
      old: existing.maxLicenses,
      new: updates.maxLicenses,
    };
    values.maxLicenses = updates.maxLicenses;
  }

  if (Object.keys(changes).length > 0) {
    await db.update(aiTools).set(values).where(eq(aiTools.id, id));
    await recordUpdate("ai_tool", id, Number(admin.id), changes);
  }

  revalidatePath("/tools");
  revalidatePath(`/tools/${id}`);
  return { success: true, data: undefined };
}

export async function archiveTool(input: {
  id: number;
}): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const existing = await db.query.aiTools.findFirst({
    where: eq(aiTools.id, input.id),
  });
  if (!existing) return { success: false, error: "Tool not found" };

  // FR-019: Check for active assignments
  const [activeCount] = await db
    .select({ count: count() })
    .from(licenseAssignments)
    .where(
      and(
        eq(licenseAssignments.toolId, input.id),
        eq(licenseAssignments.status, "active"),
      ),
    );

  if (activeCount.count > 0) {
    return {
      success: false,
      error: "Cannot archive tool with active license assignments",
    };
  }

  await db
    .update(aiTools)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(aiTools.id, input.id));

  await recordStatusChange(
    "ai_tool",
    input.id,
    Number(admin.id),
    existing.status,
    "archived",
  );

  revalidatePath("/tools");
  return { success: true, data: undefined };
}

// ---- Tier Actions ----

export async function createTier(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = tierSchema.safeParse(input);
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

  const { toolId, name, description, monthlyCostCents } = parsed.data;

  // Check uniqueness within tool
  const existingTier = await db.query.accessTiers.findFirst({
    where: and(eq(accessTiers.toolId, toolId), eq(accessTiers.name, name)),
  });
  if (existingTier) {
    return {
      success: false,
      error: "A tier with this name already exists for this tool",
    };
  }

  const [tier] = await db
    .insert(accessTiers)
    .values({
      toolId,
      name,
      description: description ?? null,
      monthlyCostCents,
    })
    .returning({ id: accessTiers.id });

  await recordCreation("access_tier", tier.id, Number(admin.id));

  revalidatePath(`/tools/${toolId}`);
  return { success: true, data: { id: tier.id } };
}

export async function updateTier(input: unknown): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = updateTierSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Validation failed" };
  }

  const { id, ...updates } = parsed.data;

  const existing = await db.query.accessTiers.findFirst({
    where: eq(accessTiers.id, id),
  });
  if (!existing) return { success: false, error: "Tier not found" };

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  const values: Record<string, unknown> = { updatedAt: new Date() };

  if (updates.name !== undefined && updates.name !== existing.name) {
    // Check uniqueness within tool
    const duplicate = await db.query.accessTiers.findFirst({
      where: and(
        eq(accessTiers.toolId, existing.toolId),
        eq(accessTiers.name, updates.name),
      ),
    });
    if (duplicate) {
      return {
        success: false,
        error: "A tier with this name already exists for this tool",
      };
    }
    changes.name = { old: existing.name, new: updates.name };
    values.name = updates.name;
  }
  if (
    updates.description !== undefined &&
    updates.description !== existing.description
  ) {
    changes.description = {
      old: existing.description,
      new: updates.description,
    };
    values.description = updates.description;
  }
  if (
    updates.monthlyCostCents !== undefined &&
    updates.monthlyCostCents !== existing.monthlyCostCents
  ) {
    changes.monthlyCostCents = {
      old: existing.monthlyCostCents,
      new: updates.monthlyCostCents,
    };
    values.monthlyCostCents = updates.monthlyCostCents;
  }
  if (
    updates.isActive !== undefined &&
    updates.isActive !== existing.isActive
  ) {
    // If deactivating, check for active assignments
    if (!updates.isActive) {
      const [activeCount] = await db
        .select({ count: count() })
        .from(licenseAssignments)
        .where(
          and(
            eq(licenseAssignments.tierId, id),
            eq(licenseAssignments.status, "active"),
          ),
        );
      if (activeCount.count > 0) {
        return {
          success: false,
          error: "Cannot deactivate tier with active assignments",
        };
      }
    }
    changes.isActive = { old: existing.isActive, new: updates.isActive };
    values.isActive = updates.isActive;
  }

  if (Object.keys(changes).length > 0) {
    const newCostCents = changes.monthlyCostCents
      ? updates.monthlyCostCents
      : undefined;

    await db.transaction(async (tx) => {
      await tx.update(accessTiers).set(values).where(eq(accessTiers.id, id));

      // Every spend aggregation (reports, dashboard, budget expected spend)
      // sums license_assignments.cost_at_assignment_cents, so active
      // assignments must follow the tier's new price or reports keep showing
      // the old one. Revoked assignments keep their historical snapshot.
      if (newCostCents !== undefined) {
        await tx
          .update(licenseAssignments)
          .set({ costAtAssignmentCents: newCostCents, updatedAt: new Date() })
          .where(
            and(
              eq(licenseAssignments.tierId, id),
              eq(licenseAssignments.status, "active"),
            ),
          );
      }
    });
    await recordUpdate("access_tier", id, Number(admin.id), changes);

    if (newCostCents !== undefined) {
      revalidatePath("/");
      revalidatePath("/assignments");
      revalidatePath("/budget");
      revalidatePath("/reports");
      revalidatePath("/reports/budget");
    }
  }

  revalidatePath(`/tools/${existing.toolId}`);
  return { success: true, data: undefined };
}

// ---- Read helpers ----

export async function getTools(): Promise<AiTool[]> {
  return db.query.aiTools.findMany({
    orderBy: (tools, { asc }) => [asc(tools.name)],
  });
}

export async function getToolWithTiers(id: number) {
  return db.query.aiTools.findFirst({
    where: eq(aiTools.id, id),
    with: {
      accessTiers: {
        orderBy: (tiers, { asc }) => [asc(tiers.name)],
      },
    },
  });
}

export async function getActiveAssignmentCountForTool(
  toolId: number,
): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(licenseAssignments)
    .where(
      and(
        eq(licenseAssignments.toolId, toolId),
        eq(licenseAssignments.status, "active"),
      ),
    );
  return result.count;
}

export async function getActiveAssignmentCountForTier(
  tierId: number,
): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(licenseAssignments)
    .where(
      and(
        eq(licenseAssignments.tierId, tierId),
        eq(licenseAssignments.status, "active"),
      ),
    );
  return result.count;
}
