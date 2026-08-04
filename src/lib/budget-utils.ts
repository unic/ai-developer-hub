import { db } from "@/lib/db";
import {
  budgetPeriods,
  annualBudgets,
  anthropicWorkspaceCosts,
  anthropicWorkspaces,
} from "@/lib/db/schema";
import { eq, and, lte, gte, desc, sql } from "drizzle-orm";

/**
 * Resolve the active budget new writes attach to (spec 041). The schema
 * permits multiple status='active' rows, so the contract is deterministic:
 * the active budget with the highest fiscal year wins. getActiveBudget() in
 * actions/budget.ts orders by the same rule — keep them in sync.
 */
export async function getActiveBudgetId(): Promise<number | null> {
  const [budget] = await db
    .select({ id: annualBudgets.id })
    .from(annualBudgets)
    .where(eq(annualBudgets.status, "active"))
    .orderBy(desc(annualBudgets.fiscalYear))
    .limit(1);
  return budget?.id ?? null;
}

/**
 * Find the active budget period that covers a given date.
 * Returns the period id and label, or null if no period matches.
 */
export async function findActivePeriodForDate(
  invoiceDate: string,
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
        gte(budgetPeriods.endDate, invoiceDate),
      ),
    )
    // Tie-break between multiple active budgets by the same deterministic
    // rule as getActiveBudgetId(): highest fiscal year wins.
    .orderBy(desc(annualBudgets.fiscalYear))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Find the best matching budget period for a given date.
 * Searches all budgets (active + archived), preferring active budgets.
 */
export async function findPeriodForDate(
  invoiceDate: string,
): Promise<{ id: number; periodLabel: string } | null> {
  const rows = await db
    .select({
      id: budgetPeriods.id,
      periodLabel: budgetPeriods.periodLabel,
    })
    .from(budgetPeriods)
    .innerJoin(annualBudgets, eq(budgetPeriods.budgetId, annualBudgets.id))
    .where(
      sql`${budgetPeriods.startDate} <= ${invoiceDate} AND ${budgetPeriods.endDate} >= ${invoiceDate}`,
    )
    .orderBy(
      sql`CASE WHEN ${annualBudgets.status} = 'active' THEN 0 ELSE 1 END ASC`,
      // Same deterministic tie-break as getActiveBudgetId().
      desc(annualBudgets.fiscalYear),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * An assignment, reduced to what per-period cost attribution needs.
 * `revokedAt === null` means still held.
 */
export interface AssignmentCostWindow {
  assignedAt: Date;
  revokedAt: Date | null;
  costAtAssignmentCents: number;
}

/**
 * How a revocation landing exactly on periodStart is treated.
 *
 * The two per-period readers disagree, and always have: getBudgetWithCosts
 * counts that assignment (`>=`), fetchPerToolByPeriod does not (`>`). The
 * difference is one edge case and predates spec 042, so it is preserved rather
 * than silently changed here — but it is now a parameter of one shared predicate
 * instead of two independently-inlined copies, so the two can no longer drift on
 * anything else.
 */
export type RevokedBound = "inclusive" | "exclusive";

/**
 * Does an assignment's held-window overlap a budget period?
 *
 * Extracted (spec 042) so the double-counting property can be pinned by a unit
 * test that actually runs in CI — integration tests are disabled there
 * (.github/workflows/ci.yml). Both readers inlined this predicate, which meant
 * the single most consequential arithmetic rule in the app had no automated
 * guard.
 *
 * Cost is the flat monthly tier price with NO proration, so an assignment that
 * overlaps a period by one day contributes a full month. That is what makes
 * "close the old row and open a new one" double-count the switch period: both
 * rows overlap it. A tier change must therefore mutate in place — see
 * specs/042-assignment-tier-change.
 */
export function overlapsPeriod(
  assignment: AssignmentCostWindow,
  periodStart: Date,
  periodEnd: Date,
  revokedBound: RevokedBound = "inclusive",
): boolean {
  if (assignment.assignedAt > periodEnd) return false;
  if (assignment.revokedAt === null) return true;
  return revokedBound === "inclusive"
    ? assignment.revokedAt >= periodStart
    : assignment.revokedAt > periodStart;
}

/** Sum the flat monthly cost of every assignment overlapping a period. */
export function sumExpectedSpendCents(
  assignments: readonly AssignmentCostWindow[],
  periodStart: Date,
  periodEnd: Date,
  revokedBound: RevokedBound = "inclusive",
): number {
  return assignments
    .filter((a) => overlapsPeriod(a, periodStart, periodEnd, revokedBound))
    .reduce((total, a) => total + a.costAtAssignmentCents, 0);
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
  periodId: number,
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
      lastUpdatedAt: sql<
        string | null
      >`MAX(${anthropicWorkspaceCosts.updatedAt})`,
    })
    .from(anthropicWorkspaceCosts)
    .leftJoin(
      anthropicWorkspaces,
      sql`${anthropicWorkspaceCosts.workspaceId} IS NOT DISTINCT FROM ${anthropicWorkspaces.workspaceId}`,
    )
    .where(
      and(
        sql`${anthropicWorkspaceCosts.date} >= ${period.startDate}`,
        sql`${anthropicWorkspaceCosts.date} <= ${period.endDate}`,
      ),
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
      ? (lastUpdatedAt as unknown) instanceof Date
        ? (lastUpdatedAt as unknown as Date).toISOString()
        : new Date(lastUpdatedAt).toISOString()
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
