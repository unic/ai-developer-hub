"use server";

import { db } from "@/lib/db";
import {
  annualBudgets,
  budgetPeriods,
  licenseAssignments,
  aiTools,
  billedCosts,
  changeHistory,
} from "@/lib/db/schema";
import { eq, and, sum, count, lte, gte, or, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  budgetSchema,
  budgetAllocationSchema,
  updateBudgetTotalSchema,
  billedCostSchema,
  updateBilledCostSchema,
  deleteBilledCostSchema,
} from "@/lib/validators";
import type { ActionResult, AnnualBudget, BudgetPeriod, BudgetWithCosts } from "@/types";
import { recordCreation, recordUpdate } from "@/actions/history";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") return null;
  return session.user;
}

export async function createBudget(
  input: unknown
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
      .values({ fiscalYear, totalAmountCents, periodType })
      .returning({ id: annualBudgets.id });

    budgetId = budget.id;

    // Auto-generate periods
    const periods = generatePeriods(fiscalYear, periodType, budget.id);
    await tx.insert(budgetPeriods).values(periods);
  });

  await recordCreation("annual_budget", budgetId!, Number(admin.id));

  revalidatePath("/budget");
  return { success: true, data: { id: budgetId! } };
}

function generatePeriods(
  year: number,
  type: "monthly" | "quarterly",
  budgetId: number
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
    return Array.from({ length: 12 }, (_, i) => ({
      budgetId,
      periodLabel: `${months[i]} ${year}`,
      periodIndex: i,
      startDate: `${year}-${String(i + 1).padStart(2, "0")}-01`,
      endDate:
        i === 11
          ? `${year}-12-31`
          : `${year}-${String(i + 2).padStart(2, "0")}-01`,
      plannedAmountCents: 0,
    }));
  }

  // Quarterly
  return [
    {
      budgetId,
      periodLabel: `Q1 ${year}`,
      periodIndex: 0,
      startDate: `${year}-01-01`,
      endDate: `${year}-04-01`,
      plannedAmountCents: 0,
    },
    {
      budgetId,
      periodLabel: `Q2 ${year}`,
      periodIndex: 1,
      startDate: `${year}-04-01`,
      endDate: `${year}-07-01`,
      plannedAmountCents: 0,
    },
    {
      budgetId,
      periodLabel: `Q3 ${year}`,
      periodIndex: 2,
      startDate: `${year}-07-01`,
      endDate: `${year}-10-01`,
      plannedAmountCents: 0,
    },
    {
      budgetId,
      periodLabel: `Q4 ${year}`,
      periodIndex: 3,
      startDate: `${year}-10-01`,
      endDate: `${year + 1}-01-01`,
      plannedAmountCents: 0,
    },
  ];
}

export async function updateBudgetAllocations(
  input: unknown
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
      eq(annualBudgets.status, "active")
    ),
  });
  if (!budget) {
    return { success: false, error: "Active budget not found" };
  }

  // FR-010: Validate sum does not exceed total
  const totalAllocated = allocations.reduce(
    (sum, a) => sum + a.plannedAmountCents,
    0
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
  return { success: true, data: undefined };
}

export async function updateBudgetTotal(
  input: unknown
): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = updateBudgetTotalSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Validation failed" };
  }

  const { budgetId, totalAmountCents } = parsed.data;

  const budget = await db.query.annualBudgets.findFirst({
    where: and(
      eq(annualBudgets.id, budgetId),
      eq(annualBudgets.status, "active")
    ),
    with: { periods: true },
  });
  if (!budget) {
    return { success: false, error: "Active budget not found" };
  }

  const currentAllocations = budget.periods.reduce(
    (sum, p) => sum + p.plannedAmountCents,
    0
  );
  if (totalAmountCents < currentAllocations) {
    return {
      success: false,
      error: "New total cannot be less than existing allocations",
    };
  }

  await db
    .update(annualBudgets)
    .set({ totalAmountCents, updatedAt: new Date() })
    .where(eq(annualBudgets.id, budgetId));

  await recordUpdate("annual_budget", budgetId, Number(admin.id), {
    totalAmountCents: {
      old: budget.totalAmountCents,
      new: totalAmountCents,
    },
  });

  revalidatePath("/budget");
  revalidatePath(`/budget/${budgetId}`);
  return { success: true, data: undefined };
}

// Read helpers
export async function getActiveBudget() {
  return db.query.annualBudgets.findFirst({
    where: eq(annualBudgets.status, "active"),
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

export async function getBudgets() {
  return db.query.annualBudgets.findMany({
    orderBy: (b, { desc }) => [desc(b.fiscalYear)],
  });
}

// US5: Expected spend calculation for a budget period (based on active license assignments)
export async function getExpectedSpendForPeriod(
  startDate: string,
  endDate: string
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
          gte(licenseAssignments.revokedAt, new Date(startDate))
        )
      )
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
  input: unknown
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
    .values({ periodId, amountCents, invoiceDate, description, vendorReference })
    .returning({ id: billedCosts.id });

  await recordCreation("billed_cost", billedCost.id, Number(admin.id));

  revalidatePath("/budget");
  revalidatePath(`/budget/${period.budgetId}`);
  return { success: true, data: { id: billedCost.id } };
}

// US6: Update an existing billed cost entry
export async function updateBilledCost(
  input: unknown
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
    return { success: false, error: "Cannot modify costs on an archived budget" };
  }

  // Build changes record for history
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  if (updates.amountCents !== undefined && updates.amountCents !== existing.amountCents) {
    changes.amountCents = { old: existing.amountCents, new: updates.amountCents };
  }
  if (updates.invoiceDate !== undefined && updates.invoiceDate !== existing.invoiceDate) {
    changes.invoiceDate = { old: existing.invoiceDate, new: updates.invoiceDate };
  }
  if (updates.description !== undefined && updates.description !== existing.description) {
    changes.description = { old: existing.description, new: updates.description };
  }
  if (updates.vendorReference !== undefined && updates.vendorReference !== existing.vendorReference) {
    changes.vendorReference = { old: existing.vendorReference, new: updates.vendorReference };
  }

  // Filter out undefined values for the update
  const setValues: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.amountCents !== undefined) setValues.amountCents = updates.amountCents;
  if (updates.invoiceDate !== undefined) setValues.invoiceDate = updates.invoiceDate;
  if (updates.description !== undefined) setValues.description = updates.description;
  if (updates.vendorReference !== undefined) setValues.vendorReference = updates.vendorReference;

  await db
    .update(billedCosts)
    .set(setValues)
    .where(eq(billedCosts.id, id));

  if (Object.keys(changes).length > 0) {
    await recordUpdate("billed_cost", id, Number(admin.id), changes);
  }

  revalidatePath("/budget");
  revalidatePath(`/budget/${existing.period.budgetId}`);
  return { success: true, data: undefined };
}

// US6: Delete a billed cost entry
export async function deleteBilledCost(
  input: unknown
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
    return { success: false, error: "Cannot delete costs on an archived budget" };
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
  return { success: true, data: undefined };
}

// US6: Load budget with computed cost data per period
export async function getBudgetWithCosts(
  budgetId: number
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
    },
  });

  if (!budget) return null;

  const periodsWithCosts = await Promise.all(
    budget.periods.map(async (period) => {
      const expectedSpendCents = await getExpectedSpendForPeriod(
        period.startDate,
        period.endDate
      );

      const billedTotalCents = period.billedCosts.reduce(
        (sum, bc) => sum + bc.amountCents,
        0
      );

      return {
        ...period,
        expectedSpendCents,
        billedTotalCents,
        billedEntries: period.billedCosts,
      };
    })
  );

  return {
    ...budget,
    periods: periodsWithCosts,
  };
}

// US5: Per-tool spending breakdown for a period
export async function getPerToolSpend(startDate: string, endDate: string) {
  const result = await db
    .select({
      toolId: aiTools.id,
      toolName: aiTools.name,
      totalCents: sum(licenseAssignments.costAtAssignmentCents),
      assignmentCount: count(licenseAssignments.id),
    })
    .from(licenseAssignments)
    .innerJoin(aiTools, eq(licenseAssignments.toolId, aiTools.id))
    .where(
      and(
        eq(licenseAssignments.status, "active"),
        lte(licenseAssignments.assignedAt, new Date(endDate)),
        or(
          isNull(licenseAssignments.revokedAt),
          gte(licenseAssignments.revokedAt, new Date(startDate))
        )
      )
    )
    .groupBy(aiTools.id, aiTools.name);

  return result.map((r) => ({
    ...r,
    totalCents: Number(r.totalCents ?? 0),
  }));
}
