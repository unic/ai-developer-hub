"use server";

import { db } from "@/lib/db";
import {
  annualBudgets,
  budgetPeriods,
  budgetExtensions,
  budgetExtensionPeriodAllocations,
  changeHistory,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import {
  createBudgetExtensionSchema,
  updateBudgetExtensionSchema,
  deleteBudgetExtensionSchema,
} from "@/lib/validators";
import { recordCreation, recordUpdate } from "@/actions/history";
import type { ActionResult } from "@/types";
import { z } from "zod";

type AllocationInput = z.infer<
  typeof createBudgetExtensionSchema
>["allocation"];

type ResolveResult =
  | { ok: true; byPeriodId: Record<number, number> }
  | { ok: false; error: string };

/**
 * Translate the user-chosen allocation mode into a map of period id → delta.
 * The deltas sum to the extension's amountCents when the user chose a real
 * allocation, or sum to 0 when they chose "unallocated" (the ceiling rises
 * but no period is touched).
 */
function resolveAllocations(
  amountCents: number,
  allocation: AllocationInput,
  periods: { id: number; endDate: string }[],
  effectiveDate: string
): ResolveResult {
  switch (allocation.mode) {
    case "unallocated":
      return { ok: true, byPeriodId: {} };

    case "single_period": {
      const exists = periods.find((p) => p.id === allocation.periodId);
      if (!exists) return { ok: false, error: "Period not found in budget" };
      return { ok: true, byPeriodId: { [allocation.periodId]: amountCents } };
    }

    case "distribute_remaining": {
      // "Remaining" = periods whose endDate >= effectiveDate. Falls back to
      // all periods if effectiveDate is before every period's end (i.e.
      // backdated extensions covering the full year).
      const remaining = periods.filter((p) => p.endDate >= effectiveDate);
      const target = remaining.length > 0 ? remaining : periods;
      if (target.length === 0) {
        return { ok: false, error: "Budget has no periods to distribute into" };
      }
      const per = Math.trunc(amountCents / target.length);
      const remainder = amountCents - per * target.length;
      const byPeriodId: Record<number, number> = {};
      target.forEach((p, idx) => {
        // Push the rounding remainder onto the first period so the sum is exact.
        byPeriodId[p.id] = per + (idx === 0 ? remainder : 0);
      });
      return { ok: true, byPeriodId };
    }

    case "custom": {
      const sumCents = allocation.allocations.reduce(
        (s, a) => s + a.amountCents,
        0
      );
      if (sumCents !== amountCents) {
        return {
          ok: false,
          error: `Custom allocations sum to ${sumCents}; must equal extension amount ${amountCents}`,
        };
      }
      const validIds = new Set(periods.map((p) => p.id));
      const byPeriodId: Record<number, number> = {};
      for (const a of allocation.allocations) {
        if (!validIds.has(a.periodId)) {
          return { ok: false, error: "Allocation references a period not in this budget" };
        }
        byPeriodId[a.periodId] = (byPeriodId[a.periodId] ?? 0) + a.amountCents;
      }
      return { ok: true, byPeriodId };
    }
  }
}

export async function createBudgetExtension(
  input: unknown
): Promise<ActionResult<{ id: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = createBudgetExtensionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  // Load budget + periods (lightweight — we don't need billed costs here).
  const budget = await db.query.annualBudgets.findFirst({
    where: eq(annualBudgets.id, data.budgetId),
    with: {
      periods: {
        orderBy: (p, { asc }) => [asc(p.periodIndex)],
      },
    },
  });
  if (!budget) return { success: false, error: "Budget not found" };
  if (budget.status === "archived") {
    return { success: false, error: "Archived budgets cannot be modified" };
  }

  // Effective date must fall within the fiscal year (lexical compare works
  // because the year prefix dominates an ISO date).
  if (!data.effectiveDate.startsWith(`${budget.fiscalYear}-`)) {
    return {
      success: false,
      error: "Effective date must fall within the fiscal year",
    };
  }

  // Resolve the chosen allocation mode into per-period deltas.
  const resolved = resolveAllocations(
    data.amountCents,
    data.allocation,
    budget.periods.map((p) => ({ id: p.id, endDate: p.endDate })),
    data.effectiveDate
  );
  if (!resolved.ok) return { success: false, error: resolved.error };

  // Guard: total allocations after this change must remain ≤ new ceiling
  // and the new ceiling cannot go ≤ 0.
  const newCeiling = budget.totalAmountCents + data.amountCents;
  if (newCeiling <= 0) {
    return { success: false, error: "Ceiling cannot drop to zero or below" };
  }
  const newAllocTotal = budget.periods.reduce(
    (sumCents, p) =>
      sumCents +
      p.plannedAmountCents +
      (resolved.byPeriodId[p.id] ?? 0),
    0
  );
  if (newAllocTotal > newCeiling) {
    return {
      success: false,
      error: "Per-period allocations would exceed the new ceiling",
    };
  }
  // Guard: no period's planned amount may go negative (relevant for
  // reductions). plannedAmountCents has a CHECK NOT NULL but no >= 0
  // constraint; the app keeps it non-negative as an invariant.
  for (const p of budget.periods) {
    const next = p.plannedAmountCents + (resolved.byPeriodId[p.id] ?? 0);
    if (next < 0) {
      return {
        success: false,
        error: `Period ${p.periodLabel} would have a negative planned amount`,
      };
    }
  }

  let extensionId: number = 0;

  await db.transaction(async (tx) => {
    // 1. Insert the extension row.
    const [ext] = await tx
      .insert(budgetExtensions)
      .values({
        budgetId: data.budgetId,
        amountCents: data.amountCents,
        reason: data.reason,
        description: data.description ?? null,
        category: data.category,
        linkedToolId: data.linkedToolId ?? null,
        effectiveDate: data.effectiveDate,
        createdBy: Number(admin.id),
      })
      .returning({ id: budgetExtensions.id });
    extensionId = ext.id;

    // 2. Bump the live ceiling.
    await tx
      .update(annualBudgets)
      .set({ totalAmountCents: newCeiling, updatedAt: new Date() })
      .where(eq(annualBudgets.id, data.budgetId));

    // 3. Write per-period allocation rows + bump plannedAmountCents.
    for (const [periodIdStr, amt] of Object.entries(resolved.byPeriodId)) {
      if (amt === 0) continue;
      const periodId = Number(periodIdStr);
      await tx
        .insert(budgetExtensionPeriodAllocations)
        .values({ extensionId: ext.id, periodId, amountCents: amt });
      await tx
        .update(budgetPeriods)
        .set({
          plannedAmountCents: sql`${budgetPeriods.plannedAmountCents} + ${amt}`,
          updatedAt: new Date(),
        })
        .where(eq(budgetPeriods.id, periodId));
    }
  });

  // 4. History (outside tx, matching the createBudget pattern).
  await recordCreation("budget_extension", extensionId, Number(admin.id));

  revalidatePath("/");
  revalidatePath("/budget");
  revalidatePath(`/budget/${data.budgetId}`);
  revalidatePath("/budget/history");
  revalidatePath("/reports");
  revalidatePath("/reports/budget");

  return { success: true, data: { id: extensionId } };
}

export async function updateBudgetExtension(
  input: unknown
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = updateBudgetExtensionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const existing = await db.query.budgetExtensions.findFirst({
    where: eq(budgetExtensions.id, data.extensionId),
    with: { budget: true },
  });
  if (!existing) return { success: false, error: "Extension not found" };
  if (existing.budget.status === "archived") {
    return { success: false, error: "Archived budgets cannot be modified" };
  }

  // Build a partial patch of only the fields that changed, for the audit log.
  const patch: Record<string, unknown> = {};
  const changes: Record<string, { old: unknown; new: unknown }> = {};

  if (data.reason !== undefined && data.reason !== existing.reason) {
    patch.reason = data.reason;
    changes.reason = { old: existing.reason, new: data.reason };
  }
  if (data.description !== undefined && data.description !== existing.description) {
    patch.description = data.description;
    changes.description = { old: existing.description, new: data.description };
  }
  if (data.category !== undefined && data.category !== existing.category) {
    patch.category = data.category;
    changes.category = { old: existing.category, new: data.category };
  }
  if (
    data.linkedToolId !== undefined &&
    data.linkedToolId !== existing.linkedToolId
  ) {
    patch.linkedToolId = data.linkedToolId;
    changes.linkedToolId = {
      old: existing.linkedToolId,
      new: data.linkedToolId,
    };
  }

  if (Object.keys(patch).length === 0) {
    // Nothing to do — treat as success so the UI can close without error.
    return { success: true, data: undefined };
  }

  patch.updatedAt = new Date();
  await db
    .update(budgetExtensions)
    .set(patch)
    .where(eq(budgetExtensions.id, data.extensionId));

  await recordUpdate(
    "budget_extension",
    data.extensionId,
    Number(admin.id),
    changes
  );

  revalidatePath("/budget");
  revalidatePath(`/budget/${existing.budgetId}`);

  return { success: true, data: undefined };
}

export async function deleteBudgetExtension(
  input: unknown
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = deleteBudgetExtensionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Validation failed" };

  const existing = await db.query.budgetExtensions.findFirst({
    where: eq(budgetExtensions.id, parsed.data.extensionId),
    with: {
      allocations: true,
      budget: true,
    },
  });
  if (!existing) return { success: false, error: "Extension not found" };
  if (existing.budget.status === "archived") {
    return { success: false, error: "Archived budgets cannot be modified" };
  }

  // Symmetric guard with createBudgetExtension: refuse the reversal if it
  // would drive any period's planned amount below zero. Can happen when a
  // user manually lowered plannedAmountCents (via updateBudgetAllocations)
  // *after* the extension was created — the original allocation amount is
  // no longer fully recoverable.
  if (existing.allocations.length > 0) {
    const affected = await db.query.budgetPeriods.findMany({
      where: (p, { inArray }) =>
        inArray(
          p.id,
          existing.allocations.map((a) => a.periodId)
        ),
      columns: { id: true, periodLabel: true, plannedAmountCents: true },
    });
    const byId = new Map(affected.map((p) => [p.id, p]));
    for (const alloc of existing.allocations) {
      const p = byId.get(alloc.periodId);
      if (!p) continue;
      if (p.plannedAmountCents - alloc.amountCents < 0) {
        return {
          success: false,
          error: `Cannot delete: ${p.periodLabel} planned amount has been manually lowered and the reversal would go negative. Edit the period allocation first.`,
        };
      }
    }
  }

  await db.transaction(async (tx) => {
    // Reverse each per-period allocation.
    for (const alloc of existing.allocations) {
      await tx
        .update(budgetPeriods)
        .set({
          plannedAmountCents: sql`${budgetPeriods.plannedAmountCents} - ${alloc.amountCents}`,
          updatedAt: new Date(),
        })
        .where(eq(budgetPeriods.id, alloc.periodId));
    }
    // Reverse the ceiling bump.
    await tx
      .update(annualBudgets)
      .set({
        totalAmountCents: sql`${annualBudgets.totalAmountCents} - ${existing.amountCents}`,
        updatedAt: new Date(),
      })
      .where(eq(annualBudgets.id, existing.budgetId));
    // Cascade FK removes allocation rows.
    await tx
      .delete(budgetExtensions)
      .where(eq(budgetExtensions.id, existing.id));
  });

  // Record the deletion with a full snapshot of the row + allocations as the
  // previousValue, matching the deleteBilledCost pattern in src/actions/budget.ts.
  // (recordStatusChange isn't right here — budget_extensions has no status
  // column, so an "active → deleted" transition would imply a field that
  // doesn't exist.)
  await db.insert(changeHistory).values({
    entityType: "budget_extension",
    entityId: existing.id,
    changeType: "deleted",
    previousValue: JSON.stringify({
      budgetId: existing.budgetId,
      amountCents: existing.amountCents,
      reason: existing.reason,
      description: existing.description,
      category: existing.category,
      linkedToolId: existing.linkedToolId,
      effectiveDate: existing.effectiveDate,
      allocations: existing.allocations.map((a) => ({
        periodId: a.periodId,
        amountCents: a.amountCents,
      })),
    }),
    changedBy: Number(admin.id),
  });

  revalidatePath("/");
  revalidatePath("/budget");
  revalidatePath(`/budget/${existing.budgetId}`);
  revalidatePath("/budget/history");
  revalidatePath("/reports");
  revalidatePath("/reports/budget");

  return { success: true, data: undefined };
}
