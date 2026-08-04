"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import type { AiTool } from "@/types";
import type { ActionResult } from "@/types";
import { db } from "@/lib/db";
import { aiTools, licenseAssignments } from "@/lib/db/schema";
import { and, count, eq } from "drizzle-orm";
import { updateTierSchema } from "@/lib/validators";
import { uiContext } from "@/lib/core/context";
import {
  archiveToolCore,
  createTierCore,
  createToolCore,
  setTierPriceCore,
  updateTierCore,
  updateToolCore,
} from "@/lib/core/tools";


// ---- Tool Actions ----

export async function createTool(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const result = await createToolCore(uiContext(Number(admin.id)), input);
  if (!result.ok) {
    return {
      success: false,
      error: result.error,
      ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
    };
  }
  for (const path of result.revalidate) revalidatePath(path);
  return { success: true, data: { id: result.data.toolId } };
}

export async function updateTool(input: unknown): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const result = await updateToolCore(uiContext(Number(admin.id)), input);
  if (!result.ok) return { success: false, error: result.error };
  for (const path of result.revalidate) revalidatePath(path);
  return { success: true, data: undefined };
}

export async function archiveTool(input: {
  id: number;
}): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const result = await archiveToolCore(uiContext(Number(admin.id)), input);
  if (!result.ok) return { success: false, error: result.error };
  for (const path of result.revalidate) revalidatePath(path);
  return { success: true, data: undefined };
}

// ---- Tier Actions ----

export async function createTier(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const result = await createTierCore(uiContext(Number(admin.id)), input);
  if (!result.ok) {
    return {
      success: false,
      error: result.error,
      ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
    };
  }
  for (const path of result.revalidate) revalidatePath(path);
  return { success: true, data: { id: result.data.tierId } };
}

/**
 * Tier edit. A monthlyCostCents change is routed to setTierPriceCore so the new
 * price propagates to every active assignment's cost snapshot (spec 037) —
 * splitting the two keeps the propagating write in exactly one place, while this
 * wrapper keeps the single call the tier dialog has always made.
 */
export async function updateTier(input: unknown): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsedInput = updateTierSchema.safeParse(input);
  if (!parsedInput.success) return { success: false, error: "Validation failed" };

  const { id, monthlyCostCents, ...metadata } = parsedInput.data;
  const ctx = uiContext(Number(admin.id));
  const paths = new Set<string>();

  if (monthlyCostCents !== undefined) {
    const priced = await setTierPriceCore(ctx, { tierId: id, monthlyCostCents });
    if (!priced.ok) return { success: false, error: priced.error };
    for (const path of priced.revalidate) paths.add(path);
  }

  // Metadata fields (if any) go through the non-propagating core.
  const hasMetadata = Object.values(metadata).some((v) => v !== undefined);
  if (hasMetadata) {
    const meta = await updateTierCore(ctx, { id, ...metadata });
    if (!meta.ok) return { success: false, error: meta.error };
    for (const path of meta.revalidate) paths.add(path);
  }

  for (const path of paths) revalidatePath(path);
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
