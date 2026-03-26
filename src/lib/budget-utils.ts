import { db } from "@/lib/db";
import {
  budgetPeriods,
  annualBudgets,
  anthropicWorkspaceCosts,
  anthropicWorkspaces,
} from "@/lib/db/schema";
import { eq, and, lte, gte, desc, sql } from "drizzle-orm";

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
        gte(budgetPeriods.endDate, invoiceDate)
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
      sql`${budgetPeriods.startDate} <= ${invoiceDate} AND ${budgetPeriods.endDate} >= ${invoiceDate}`
    )
    .orderBy(
      sql`CASE WHEN ${annualBudgets.status} = 'active' THEN 0 ELSE 1 END ASC`,
      desc(annualBudgets.createdAt)
    )
    .limit(1);

  return rows[0] ?? null;
}


/** Return type for getRunningCostsForPeriod */
export interface RunningCostsResult {
  runningCostCents: number;
  lastUpdatedAt: string | null;
  source: "anthropic_workspace_costs";
  workspaceBreakdown?: Array<{
    workspaceId: string | null;
    name: string;
    costCents: number;
  }>;
}

/**
 * Aggregate Anthropic workspace costs that fall within a budget period's
 * date range (inclusive).
 *
 * Returns `null` when SUM is zero or no rows are found so that callers
 * can simply skip rendering when there are no running costs.
 */
export async function getRunningCostsForPeriod(
  periodId: number
): Promise<RunningCostsResult | null> {
  // 1. Look up the period's start/end dates
  const period = await db.query.budgetPeriods.findFirst({
    where: eq(budgetPeriods.id, periodId),
  });
  if (!period) return null;

  // 2. Aggregate costs grouped by workspace for the date range (inclusive)
  const breakdown = await db
    .select({
      workspaceId: anthropicWorkspaceCosts.workspaceId,
      name: sql<string>`COALESCE(${anthropicWorkspaces.name}, 'Default')`,
      costCents: sql<number>`CAST(SUM(${anthropicWorkspaceCosts.costCents}) AS integer)`,
      lastUpdatedAt: sql<string | null>`MAX(${anthropicWorkspaceCosts.updatedAt})`,
    })
    .from(anthropicWorkspaceCosts)
    .leftJoin(
      anthropicWorkspaces,
      sql`${anthropicWorkspaceCosts.workspaceId} IS NOT DISTINCT FROM ${anthropicWorkspaces.workspaceId}`
    )
    .where(
      and(
        sql`${anthropicWorkspaceCosts.date} >= ${period.startDate}`,
        sql`${anthropicWorkspaceCosts.date} <= ${period.endDate}`
      )
    )
    .groupBy(anthropicWorkspaceCosts.workspaceId, anthropicWorkspaces.name);

  // 3. Return null when no rows or zero total
  if (breakdown.length === 0) return null;

  const runningCostCents = breakdown.reduce((sum, r) => sum + r.costCents, 0);
  if (runningCostCents === 0) return null;

  // 4. Derive the latest updated_at across all workspaces
  const lastUpdatedAt = breakdown.reduce<string | null>((max, r) => {
    if (!r.lastUpdatedAt) return max;
    return !max || r.lastUpdatedAt > max ? r.lastUpdatedAt : max;
  }, null);

  return {
    runningCostCents,
    lastUpdatedAt: lastUpdatedAt
      ? ((lastUpdatedAt as unknown) instanceof Date
          ? (lastUpdatedAt as unknown as Date).toISOString()
          : new Date(lastUpdatedAt).toISOString())
      : null,
    source: "anthropic_workspace_costs",
    ...(breakdown.length > 1
      ? {
          workspaceBreakdown: breakdown.map((r) => ({
            workspaceId: r.workspaceId,
            name: r.name,
            costCents: r.costCents,
          })),
        }
      : {}),
  };
}
