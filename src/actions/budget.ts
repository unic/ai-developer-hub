"use server";

import { db } from "@/lib/db";
import {
  annualBudgets,
  budgetPeriods,
  licenseAssignments,
  aiTools,
} from "@/lib/db/schema";
import { eq, and, sum, count, lte, gte, or, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  budgetSchema,
  budgetAllocationSchema,
  updateBudgetTotalSchema,
} from "@/lib/validators";
import type { ActionResult, AnnualBudget, BudgetPeriod } from "@/types";
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

// US5: Actual spend calculation for a budget period
export async function getActualSpendForPeriod(
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
