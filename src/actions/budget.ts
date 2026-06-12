"use server";

import { db } from "@/lib/db";
import {
  annualBudgets,
  budgetPeriods,
  budgetExtensions,
  licenseAssignments,
  aiTools,
  billedCosts,
  changeHistory,
} from "@/lib/db/schema";
import { eq, and, sum, count, lte, gte, or, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import {
  budgetSchema,
  budgetAllocationSchema,
  billedCostSchema,
  updateBilledCostSchema,
  deleteBilledCostSchema,
} from "@/lib/validators";
import type {
  ActionResult,
  AnnualBudget,
  BudgetPeriod,
  BudgetWithCosts,
  PeriodSpendPoint,
  BudgetForecast,
} from "@/types";
import { buildBudgetForecast } from "@/lib/forecast";
import { getRunningCostsForPeriod } from "@/lib/budget-utils";
import {
  recordCreation,
  recordUpdate,
  recordStatusChange,
} from "@/actions/history";

export async function createBudget(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = budgetSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Validation failed" };
  }

  const { fiscalYear, totalAmountCents, periodType } = parsed.data;

  // Check if fiscal year already has an active budget
  const existing = await db.query.annualBudgets.findFirst({
    where: eq(annualBudgets.fiscalYear, fiscalYear),
  });
  if (existing) {
    return {
      success: false,
      error: "A budget already exists for this fiscal year",
    };
  }

  let budgetId: number;

  await db.transaction(async (tx) => {
    // FR-021: Archive previous year's budget
    await tx
      .update(annualBudgets)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(annualBudgets.status, "active"));

    // Create budget
    const [budget] = await tx
      .insert(annualBudgets)
      .values({
        fiscalYear,
        totalAmountCents,
        // At creation, the live ceiling IS the original baseline.
        // Extensions later mutate totalAmountCents but never originalAmountCents.
        originalAmountCents: totalAmountCents,
        periodType,
      })
      .returning({ id: annualBudgets.id });

    budgetId = budget.id;

    // Auto-generate periods
    const periods = generatePeriods(fiscalYear, periodType, budget.id);
    await tx.insert(budgetPeriods).values(periods);
  });

  await recordCreation("annual_budget", budgetId!, Number(admin.id));

  revalidatePath("/budget");
  revalidatePath("/reports");
  revalidatePath("/reports/budget");
  return { success: true, data: { id: budgetId! } };
}

function generatePeriods(
  year: number,
  type: "monthly" | "quarterly",
  budgetId: number,
) {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  if (type === "monthly") {
    return Array.from({ length: 12 }, (_, i) => {
      // Last day of month i+1: create date for day 0 of the next month
      const lastDay = new Date(year, i + 1, 0).getDate();
      return {
        budgetId,
        periodLabel: `${months[i]} ${year}`,
        periodIndex: i,
        startDate: `${year}-${String(i + 1).padStart(2, "0")}-01`,
        endDate: `${year}-${String(i + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
        plannedAmountCents: 0,
      };
    });
  }

  // Quarterly
  return [
    {
      budgetId,
      periodLabel: `Q1 ${year}`,
      periodIndex: 0,
      startDate: `${year}-01-01`,
      endDate: `${year}-03-31`,
      plannedAmountCents: 0,
    },
    {
      budgetId,
      periodLabel: `Q2 ${year}`,
      periodIndex: 1,
      startDate: `${year}-04-01`,
      endDate: `${year}-06-30`,
      plannedAmountCents: 0,
    },
    {
      budgetId,
      periodLabel: `Q3 ${year}`,
      periodIndex: 2,
      startDate: `${year}-07-01`,
      endDate: `${year}-09-30`,
      plannedAmountCents: 0,
    },
    {
      budgetId,
      periodLabel: `Q4 ${year}`,
      periodIndex: 3,
      startDate: `${year}-10-01`,
      endDate: `${year}-12-31`,
      plannedAmountCents: 0,
    },
  ];
}

export async function updateBudgetAllocations(
  input: unknown,
): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = budgetAllocationSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Validation failed" };
  }

  const { budgetId, allocations } = parsed.data;

  const budget = await db.query.annualBudgets.findFirst({
    where: and(
      eq(annualBudgets.id, budgetId),
      eq(annualBudgets.status, "active"),
    ),
  });
  if (!budget) {
    return { success: false, error: "Active budget not found" };
  }

  // FR-010: Validate sum does not exceed total
  const totalAllocated = allocations.reduce(
    (sum, a) => sum + a.plannedAmountCents,
    0,
  );
  if (totalAllocated > budget.totalAmountCents) {
    return {
      success: false,
      error: "Total allocations exceed budget amount",
    };
  }

  for (const allocation of allocations) {
    await db
      .update(budgetPeriods)
      .set({
        plannedAmountCents: allocation.plannedAmountCents,
        updatedAt: new Date(),
      })
      .where(eq(budgetPeriods.id, allocation.periodId));
  }

  await recordUpdate("annual_budget", budgetId, Number(admin.id), {
    allocations: { old: "previous", new: "updated" },
  });

  revalidatePath("/budget");
  revalidatePath(`/budget/${budgetId}`);
  revalidatePath("/reports");
  revalidatePath("/reports/budget");
  return { success: true, data: undefined };
}

// NOTE (spec 026): the former `updateBudgetTotal` action was removed. It
// mutated `totalAmountCents` directly without touching `originalAmountCents`,
// which would silently break the `total = original + Σ extensions` invariant
// that the budget hero's "baseline + extended" tag relies on. It had no UI or
// test callers left. Ceiling changes now go exclusively through
// `createBudgetExtension` / `deleteBudgetExtension`, which keep the invariant
// and leave an audit trail with a reason.

export async function archiveBudget(input: {
  id: number;
}): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const existing = await db.query.annualBudgets.findFirst({
    where: eq(annualBudgets.id, input.id),
  });
  if (!existing) return { success: false, error: "Budget not found" };
  if (existing.status === "archived") {
    return { success: false, error: "Budget is already archived" };
  }

  await db
    .update(annualBudgets)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(annualBudgets.id, input.id));

  await recordStatusChange(
    "annual_budget",
    input.id,
    Number(admin.id),
    existing.status,
    "archived",
  );

  revalidatePath("/budget");
  revalidatePath("/reports");
  revalidatePath("/reports/budget");
  return { success: true, data: undefined };
}

// Read helpers
export async function getActiveBudget() {
  return db.query.annualBudgets.findFirst({
    where: eq(annualBudgets.status, "active"),
    // Deterministic resolution contract (see getActiveBudgetId in
    // lib/budget-utils.ts): the schema permits multiple active rows, and
    // every consumer must agree on which one wins.
    orderBy: (b, { desc }) => [desc(b.fiscalYear)],
    with: {
      periods: {
        orderBy: (p, { asc }) => [asc(p.periodIndex)],
      },
    },
  });
}

export async function getBudgetById(id: number) {
  return db.query.annualBudgets.findFirst({
    where: eq(annualBudgets.id, id),
    with: {
      periods: {
        orderBy: (p, { asc }) => [asc(p.periodIndex)],
      },
    },
  });
}

/**
 * List all budgets (active + archived) augmented with an extension summary
 * — count and net delta per budget. Used by the budget history page.
 */
export async function getBudgets(): Promise<
  (AnnualBudget & { extensionCount: number; extensionNetCents: number })[]
> {
  const [budgets, extensions] = await Promise.all([
    db.query.annualBudgets.findMany({
      orderBy: (b, { desc }) => [desc(b.fiscalYear)],
    }),
    db
      .select({
        budgetId: budgetExtensions.budgetId,
        count: count(),
        netCents: sum(budgetExtensions.amountCents).mapWith(Number),
      })
      .from(budgetExtensions)
      .groupBy(budgetExtensions.budgetId),
  ]);
  const byBudget = new Map(
    extensions.map((e) => [
      e.budgetId,
      { count: e.count, net: e.netCents ?? 0 },
    ]),
  );
  return budgets.map((b) => ({
    ...b,
    extensionCount: byBudget.get(b.id)?.count ?? 0,
    extensionNetCents: byBudget.get(b.id)?.net ?? 0,
  }));
}

// US5: Expected spend calculation for a budget period (based on active license assignments)
export async function getExpectedSpendForPeriod(
  startDate: string,
  endDate: string,
): Promise<number> {
  const result = await db
    .select({
      total: sum(licenseAssignments.costAtAssignmentCents),
    })
    .from(licenseAssignments)
    .where(
      and(
        eq(licenseAssignments.status, "active"),
        lte(licenseAssignments.assignedAt, new Date(endDate)),
        or(
          isNull(licenseAssignments.revokedAt),
          gte(licenseAssignments.revokedAt, new Date(startDate)),
        ),
      ),
    );

  return Number(result[0]?.total ?? 0);
}

// Helper: ensure period exists and its parent budget is not archived
async function requireActivePeriod(periodId: number) {
  const period = await db.query.budgetPeriods.findFirst({
    where: eq(budgetPeriods.id, periodId),
    with: { budget: true },
  });
  if (!period) return null;
  if (period.budget.status === "archived") return null;
  return period;
}

// US6: Create a billed cost entry
export async function createBilledCost(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = billedCostSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Validation failed" };
  }

  const { periodId, amountCents, invoiceDate, description, vendorReference } =
    parsed.data;

  const period = await requireActivePeriod(periodId);
  if (!period) {
    return {
      success: false,
      error: "Period not found or budget is archived",
    };
  }

  const [billedCost] = await db
    .insert(billedCosts)
    .values({
      periodId,
      amountCents,
      invoiceDate,
      description,
      vendorReference,
    })
    .returning({ id: billedCosts.id });

  await recordCreation("billed_cost", billedCost.id, Number(admin.id));

  revalidatePath("/budget");
  revalidatePath(`/budget/${period.budgetId}`);
  revalidatePath("/reports");
  revalidatePath("/reports/budget");
  return { success: true, data: { id: billedCost.id } };
}

// US6: Update an existing billed cost entry
export async function updateBilledCost(
  input: unknown,
): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = updateBilledCostSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Validation failed" };
  }

  const { id, ...updates } = parsed.data;

  // Load existing billed cost to check its period/budget status
  const existing = await db.query.billedCosts.findFirst({
    where: eq(billedCosts.id, id),
    with: { period: { with: { budget: true } } },
  });
  if (!existing) {
    return { success: false, error: "Billed cost not found" };
  }
  if (existing.period.budget.status === "archived") {
    return {
      success: false,
      error: "Cannot modify costs on an archived budget",
    };
  }

  // Build changes record for history
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  if (
    updates.amountCents !== undefined &&
    updates.amountCents !== existing.amountCents
  ) {
    changes.amountCents = {
      old: existing.amountCents,
      new: updates.amountCents,
    };
  }
  if (
    updates.invoiceDate !== undefined &&
    updates.invoiceDate !== existing.invoiceDate
  ) {
    changes.invoiceDate = {
      old: existing.invoiceDate,
      new: updates.invoiceDate,
    };
  }
  if (
    updates.description !== undefined &&
    updates.description !== existing.description
  ) {
    changes.description = {
      old: existing.description,
      new: updates.description,
    };
  }
  if (
    updates.vendorReference !== undefined &&
    updates.vendorReference !== existing.vendorReference
  ) {
    changes.vendorReference = {
      old: existing.vendorReference,
      new: updates.vendorReference,
    };
  }

  // Filter out undefined values for the update
  const setValues: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.amountCents !== undefined)
    setValues.amountCents = updates.amountCents;
  if (updates.invoiceDate !== undefined)
    setValues.invoiceDate = updates.invoiceDate;
  if (updates.description !== undefined)
    setValues.description = updates.description;
  if (updates.vendorReference !== undefined)
    setValues.vendorReference = updates.vendorReference;

  await db.update(billedCosts).set(setValues).where(eq(billedCosts.id, id));

  if (Object.keys(changes).length > 0) {
    await recordUpdate("billed_cost", id, Number(admin.id), changes);
  }

  revalidatePath("/budget");
  revalidatePath(`/budget/${existing.period.budgetId}`);
  revalidatePath("/reports");
  revalidatePath("/reports/budget");
  return { success: true, data: undefined };
}

// US6: Delete a billed cost entry
export async function deleteBilledCost(
  input: unknown,
): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = deleteBilledCostSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Validation failed" };
  }

  const { id } = parsed.data;

  // Load existing billed cost for archive guard and snapshot
  const existing = await db.query.billedCosts.findFirst({
    where: eq(billedCosts.id, id),
    with: { period: { with: { budget: true } } },
  });
  if (!existing) {
    return { success: false, error: "Billed cost not found" };
  }
  if (existing.period.budget.status === "archived") {
    return {
      success: false,
      error: "Cannot delete costs on an archived budget",
    };
  }

  // Record deletion with previous value snapshot
  await db.insert(changeHistory).values({
    entityType: "billed_cost",
    entityId: id,
    changeType: "deleted",
    previousValue: JSON.stringify({
      periodId: existing.periodId,
      amountCents: existing.amountCents,
      invoiceDate: existing.invoiceDate,
      description: existing.description,
      vendorReference: existing.vendorReference,
    }),
    changedBy: Number(admin.id),
  });

  await db.delete(billedCosts).where(eq(billedCosts.id, id));

  revalidatePath("/budget");
  revalidatePath(`/budget/${existing.period.budgetId}`);
  revalidatePath("/reports");
  revalidatePath("/reports/budget");
  return { success: true, data: undefined };
}

// US6: Load budget with computed cost data per period
export async function getBudgetWithCosts(
  budgetId: number,
): Promise<BudgetWithCosts | null> {
  const budget = await db.query.annualBudgets.findFirst({
    where: eq(annualBudgets.id, budgetId),
    with: {
      periods: {
        orderBy: (p, { asc }) => [asc(p.periodIndex)],
        with: {
          billedCosts: true,
        },
      },
      extensions: {
        orderBy: (e, { desc }) => [desc(e.effectiveDate), desc(e.id)],
        with: {
          allocations: true,
          linkedTool: { columns: { name: true } },
          creator: { columns: { name: true } },
        },
      },
    },
  });

  if (!budget) return null;

  // Batch: compute expected spend for all periods in a single query
  const overallStart = budget.periods.reduce(
    (min, p) => (p.startDate < min ? p.startDate : min),
    budget.periods[0].startDate,
  );
  const overallEnd = budget.periods.reduce(
    (max, p) => (p.endDate > max ? p.endDate : max),
    budget.periods[0].endDate,
  );

  // Fetch all assignments that overlap with the full budget date range
  const overlappingAssignments = await db
    .select({
      assignedAt: licenseAssignments.assignedAt,
      revokedAt: licenseAssignments.revokedAt,
      costAtAssignmentCents: licenseAssignments.costAtAssignmentCents,
    })
    .from(licenseAssignments)
    .where(
      and(
        lte(licenseAssignments.assignedAt, new Date(overallEnd)),
        or(
          isNull(licenseAssignments.revokedAt),
          gte(licenseAssignments.revokedAt, new Date(overallStart)),
        ),
      ),
    );

  // Sum extension allocations per period for the "+€X from extension" sub-label
  const extensionByPeriod: Record<number, number> = {};
  for (const ext of budget.extensions) {
    for (const a of ext.allocations) {
      extensionByPeriod[a.periodId] =
        (extensionByPeriod[a.periodId] ?? 0) + a.amountCents;
    }
  }

  const periodsWithCosts = budget.periods.map((period) => {
    const periodStart = new Date(period.startDate);
    const periodEnd = new Date(period.endDate);

    // Filter assignments overlapping this period in-memory
    const expectedSpendCents = overlappingAssignments
      .filter(
        (a) =>
          a.assignedAt <= periodEnd &&
          (a.revokedAt === null || a.revokedAt >= periodStart),
      )
      .reduce((total, a) => total + a.costAtAssignmentCents, 0);

    const billedTotalCents = period.billedCosts.reduce(
      (s, bc) => s + bc.amountCents,
      0,
    );

    return {
      ...period,
      expectedSpendCents,
      billedTotalCents,
      billedEntries: period.billedCosts,
      extensionAmountCents: extensionByPeriod[period.id] ?? 0,
    };
  });

  return {
    ...budget,
    periods: periodsWithCosts,
    // Destructure the joined rows out so the raw `linkedTool` / `creator`
    // objects don't ride along into the RSC payload — the flattened names
    // are the type contract (BudgetExtensionWithAllocations).
    extensions: budget.extensions.map(({ linkedTool, creator, ...e }) => ({
      ...e,
      linkedToolName: linkedTool?.name ?? null,
      createdByName: creator.name,
    })),
  };
}

// 005-rich-reports: Time-series spend data per period
export async function getBilledCostsTimeSeries(
  budgetId: number,
): Promise<PeriodSpendPoint[]> {
  try {
    const budgetWithCosts = await getBudgetWithCosts(budgetId);
    if (!budgetWithCosts) return [];
    const today = new Date();
    return budgetWithCosts.periods
      .filter((p) => new Date(p.startDate) <= today)
      .map((p) => ({
        month: p.periodLabel,
        billedCents: p.billedTotalCents,
        expectedCents: p.expectedSpendCents,
        plannedCents: p.plannedAmountCents,
        periodIndex: p.periodIndex,
      }));
  } catch {
    return [];
  }
}

// 005-rich-reports: Budget forecast using OLS linear regression.
// Spec 028: Actual = billed + running Anthropic API costs (matches budget detail page).
export async function getBudgetForecast(
  budgetId: number,
): Promise<ActionResult<BudgetForecast>> {
  const budget = await getBudgetWithCosts(budgetId);
  if (!budget) return { success: false, error: "Budget not found" };
  const today = new Date();
  const actualByPeriod = await fetchActualByPeriod(budget, today);
  return {
    success: true,
    data: buildBudgetForecast(budget, actualByPeriod, today),
  };
}

/**
 * Layer running Anthropic API costs onto each period's billed amount.
 * Skips future periods — they have no running data and the lookup is wasted.
 * Exposed so the reports orchestrator can share one fetch with the forecast.
 */
export async function fetchActualByPeriod(
  budget: BudgetWithCosts,
  today: Date = new Date(),
): Promise<Map<number, number>> {
  const pastOrCurrent = budget.periods.filter(
    (p) => new Date(p.startDate) <= today,
  );
  const runningResults = await Promise.all(
    pastOrCurrent.map((p) => getRunningCostsForPeriod(p.id)),
  );
  const actualByPeriod = new Map<number, number>();
  for (const p of budget.periods) {
    actualByPeriod.set(p.id, p.billedTotalCents);
  }
  pastOrCurrent.forEach((p, i) => {
    const running = runningResults[i]?.runningCostCents ?? 0;
    actualByPeriod.set(p.id, p.billedTotalCents + running);
  });
  return actualByPeriod;
}
