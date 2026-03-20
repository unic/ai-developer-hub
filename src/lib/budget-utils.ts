import { db } from "@/lib/db";
import { budgetPeriods, annualBudgets } from "@/lib/db/schema";
import { eq, and, lte, gt, desc, sql } from "drizzle-orm";

/**
 * Find the active budget period that covers a given date.
 * Returns the period id and label, or null if no period matches.
 */
export async function findActivePeriodForDate(
  invoiceDate: string
): Promise<{ id: number; periodLabel: string } | null> {
  const rows = await db
    .select({
      id: budgetPeriods.id,
      periodLabel: budgetPeriods.periodLabel,
    })
    .from(budgetPeriods)
    .innerJoin(annualBudgets, eq(budgetPeriods.budgetId, annualBudgets.id))
    .where(
      and(
        eq(annualBudgets.status, "active"),
        lte(budgetPeriods.startDate, invoiceDate),
        gt(budgetPeriods.endDate, invoiceDate)
      )
    )
    .orderBy(desc(annualBudgets.createdAt))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Find the best matching budget period for a given date.
 * Searches all budgets (active + archived), preferring active budgets.
 */
export async function findPeriodForDate(
  invoiceDate: string
): Promise<{ id: number; periodLabel: string } | null> {
  const rows = await db
    .select({
      id: budgetPeriods.id,
      periodLabel: budgetPeriods.periodLabel,
    })
    .from(budgetPeriods)
    .innerJoin(annualBudgets, eq(budgetPeriods.budgetId, annualBudgets.id))
    .where(
      sql`${budgetPeriods.startDate} <= ${invoiceDate} AND ${budgetPeriods.endDate} > ${invoiceDate}`
    )
    .orderBy(
      sql`CASE WHEN ${annualBudgets.status} = 'active' THEN 0 ELSE 1 END ASC`,
      desc(annualBudgets.createdAt)
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Build a vendor reference string for Copilot billing sync.
 * Format: github-billing-copilot-YYYY-MM
 */
export function buildCopilotVendorRef(billingMonth: string): string {
  const date = new Date(billingMonth);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `github-billing-copilot-${yyyy}-${mm}`;
}
