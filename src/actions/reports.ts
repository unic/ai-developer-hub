"use server";

import { db } from "@/lib/db";
import { aiTools, licenseAssignments } from "@/lib/db/schema";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { getActiveBudget, getBudgetWithCosts } from "@/actions/budget";
import { getRunningCostsForPeriod } from "@/lib/budget-utils";
import { buildBudgetForecast } from "@/lib/forecast";
import { classifyPeriod } from "@/lib/reports/period-helpers";
import type {
  BudgetPerToolRow,
  BudgetReportData,
  BudgetReportPastMonth,
  BudgetWithCosts,
  PeriodWithActual,
} from "@/types";

/**
 * Spec 028 — Reports v2 · Budget tab orchestrator.
 *
 * Returns everything the Budget tab needs in one round-trip. Mirrors the
 * `Actual = billed + running` pattern from `src/app/budget/[id]/budget-detail-client.tsx`.
 */
export async function getBudgetReportData(): Promise<BudgetReportData> {
  const active = await getActiveBudget();
  if (!active) return { kind: "empty", reason: "no_active_budget" };

  const budget = await getBudgetWithCosts(active.id);
  if (!budget) return { kind: "empty", reason: "no_active_budget" };

  const today = new Date();
  const pastOrCurrent = budget.periods.filter(
    (p) => new Date(p.startDate) <= today
  );

  const [runningResults, perToolByPeriod] = await Promise.all([
    Promise.all(pastOrCurrent.map((p) => getRunningCostsForPeriod(p.id))),
    fetchPerToolByPeriod(budget),
  ]);

  const runningByPeriod = new Map<number, RunningSlice>();
  pastOrCurrent.forEach((p, i) => {
    const r = runningResults[i];
    if (r) runningByPeriod.set(p.id, toRunningSlice(r));
  });

  const periodsWithActual: PeriodWithActual[] = budget.periods.map((p) => {
    const running = runningByPeriod.get(p.id)?.totalCents ?? 0;
    return {
      ...p,
      runningCostCents: running,
      actualCents: p.billedTotalCents + running,
    };
  });

  const actualByPeriod = new Map(
    periodsWithActual.map((p) => [p.id, p.actualCents])
  );
  const forecast = buildBudgetForecast(budget, actualByPeriod, today);

  const pastMonth = buildPastMonth(periodsWithActual, perToolByPeriod);
  const perTool = buildPerToolBreakdown(
    periodsWithActual,
    runningByPeriod,
    perToolByPeriod,
    today
  );

  return {
    kind: "ready",
    budget,
    periodsWithActual,
    forecast,
    pastMonth,
    perTool,
  };
}

type RunningSlice = {
  totalCents: number;
  workspaceBreakdown?: Array<{
    workspaceId: string | null;
    name: string;
    costCents: number;
  }>;
};

function toRunningSlice(
  r: NonNullable<Awaited<ReturnType<typeof getRunningCostsForPeriod>>>
): RunningSlice {
  return {
    totalCents: r.runningCostCents,
    workspaceBreakdown: r.workspaceBreakdown,
  };
}

type PerToolEntry = { toolName: string; cents: number };
type PerToolByPeriod = Map<number, Map<number, PerToolEntry>>;

/**
 * One DB round-trip per Budget tab render: load every assignment that overlaps
 * the full fiscal year, then bucket each into the periods it spans. Returns a
 * Map<periodId, Map<toolId, { toolName, cents }>>.
 */
async function fetchPerToolByPeriod(
  budget: BudgetWithCosts
): Promise<PerToolByPeriod> {
  const empty: PerToolByPeriod = new Map(
    budget.periods.map((p) => [p.id, new Map()])
  );
  if (budget.periods.length === 0) return empty;

  const overallStart = budget.periods.reduce(
    (min, p) => (p.startDate < min ? p.startDate : min),
    budget.periods[0].startDate
  );
  const overallEnd = budget.periods.reduce(
    (max, p) => (p.endDate > max ? p.endDate : max),
    budget.periods[0].endDate
  );

  const rows = await db
    .select({
      toolId: aiTools.id,
      toolName: aiTools.name,
      assignedAt: licenseAssignments.assignedAt,
      revokedAt: licenseAssignments.revokedAt,
      costAtAssignmentCents: licenseAssignments.costAtAssignmentCents,
    })
    .from(licenseAssignments)
    .innerJoin(aiTools, eq(licenseAssignments.toolId, aiTools.id))
    .where(
      and(
        lte(licenseAssignments.assignedAt, new Date(overallEnd)),
        or(
          isNull(licenseAssignments.revokedAt),
          gte(licenseAssignments.revokedAt, new Date(overallStart))
        )
      )
    );

  for (const p of budget.periods) {
    const periodStart = new Date(p.startDate);
    const periodEnd = new Date(p.endDate);
    const bucket = empty.get(p.id)!;
    for (const r of rows) {
      if (
        r.assignedAt <= periodEnd &&
        (r.revokedAt === null || r.revokedAt >= periodStart)
      ) {
        const existing = bucket.get(r.toolId);
        if (existing) {
          existing.cents += r.costAtAssignmentCents;
        } else {
          bucket.set(r.toolId, {
            toolName: r.toolName,
            cents: r.costAtAssignmentCents,
          });
        }
      }
    }
  }
  return empty;
}

function buildPastMonth(
  periods: PeriodWithActual[],
  perToolByPeriod: PerToolByPeriod
): BudgetReportPastMonth | null {
  const today = new Date();
  const past = periods
    .filter((p) => new Date(p.endDate) < today && p.actualCents > 0)
    .at(-1);
  if (!past) return null;

  const priorIndex = periods.findIndex((p) => p.id === past.id) - 1;
  const prior = priorIndex >= 0 ? periods[priorIndex] : null;

  const variance = past.actualCents - past.plannedAmountCents;
  const variancePct = pctChange(past.actualCents, past.plannedAmountCents);

  const drivers = buildVarianceDrivers(past, prior, perToolByPeriod);

  return {
    periodId: past.id,
    periodLabel: past.periodLabel,
    plannedCents: past.plannedAmountCents,
    billedCents: past.billedTotalCents,
    runningCents: past.runningCostCents,
    actualCents: past.actualCents,
    varianceCents: variance,
    variancePct,
    drivers,
  };
}

function pctChange(value: number, base: number): number | null {
  return base > 0 ? ((value - base) / base) * 100 : null;
}

function buildVarianceDrivers(
  past: PeriodWithActual,
  prior: PeriodWithActual | null,
  perToolByPeriod: PerToolByPeriod
): BudgetReportPastMonth["drivers"] {
  if (!prior) return [];
  const pastTools = perToolByPeriod.get(past.id) ?? new Map<number, PerToolEntry>();
  const priorTools =
    perToolByPeriod.get(prior.id) ?? new Map<number, PerToolEntry>();

  const deltas: BudgetReportPastMonth["drivers"] = [];
  for (const [toolId, { toolName, cents }] of pastTools) {
    const priorCents = priorTools.get(toolId)?.cents ?? 0;
    const delta = cents - priorCents;
    if (Math.abs(delta) < 1) continue;
    deltas.push({
      toolId,
      toolName,
      deltaCents: delta,
      deltaPct: pctChange(cents, priorCents),
    });
  }
  for (const [toolId, { toolName, cents }] of priorTools) {
    if (pastTools.has(toolId)) continue;
    deltas.push({ toolId, toolName, deltaCents: -cents, deltaPct: -100 });
  }

  return deltas
    .sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents))
    .slice(0, 5);
}

function buildPerToolBreakdown(
  periods: PeriodWithActual[],
  runningByPeriod: Map<number, RunningSlice>,
  perToolByPeriod: PerToolByPeriod,
  today: Date
): BudgetPerToolRow[] {
  const completedPeriods = periods.filter((p) => classifyPeriod(p, today) === "past");
  const currentPeriod = periods.find((p) => classifyPeriod(p, today) === "current");
  const remainingPeriods = periods.filter(
    (p) => classifyPeriod(p, today) === "future"
  ).length;

  const ytdByTool = new Map<number, PerToolEntry>();
  for (const p of completedPeriods) {
    const bucket = perToolByPeriod.get(p.id);
    if (!bucket) continue;
    for (const [toolId, { toolName, cents }] of bucket) {
      const existing = ytdByTool.get(toolId);
      if (existing) existing.cents += cents;
      else ytdByTool.set(toolId, { toolName, cents });
    }
  }

  const currentByTool = currentPeriod
    ? perToolByPeriod.get(currentPeriod.id) ?? new Map<number, PerToolEntry>()
    : new Map<number, PerToolEntry>();

  const rows: BudgetPerToolRow[] = [];
  const seen = new Set<number>();

  for (const [toolId, { toolName, cents: ytd }] of ytdByTool) {
    const current = currentByTool.get(toolId)?.cents ?? 0;
    rows.push({
      toolId,
      toolName,
      isAnthropicApi: false,
      ytdSpentCents: ytd,
      currentMonthlyCents: current,
      projectedEoyCents: ytd + current * (remainingPeriods + 1),
    });
    seen.add(toolId);
  }
  for (const [toolId, { toolName, cents: current }] of currentByTool) {
    if (seen.has(toolId)) continue;
    rows.push({
      toolId,
      toolName,
      isAnthropicApi: false,
      ytdSpentCents: 0,
      currentMonthlyCents: current,
      projectedEoyCents: current * (remainingPeriods + 1),
    });
  }

  const ytdRunning = completedPeriods.reduce(
    (s, p) => s + (runningByPeriod.get(p.id)?.totalCents ?? 0),
    0
  );
  const currentRunning = currentPeriod
    ? runningByPeriod.get(currentPeriod.id)?.totalCents ?? 0
    : 0;
  const currentWorkspaceBreakdown = currentPeriod
    ? runningByPeriod.get(currentPeriod.id)?.workspaceBreakdown
    : undefined;
  if (ytdRunning > 0 || currentRunning > 0) {
    rows.push({
      toolId: null,
      toolName: "Anthropic API",
      isAnthropicApi: true,
      ytdSpentCents: ytdRunning,
      currentMonthlyCents: currentRunning,
      projectedEoyCents: ytdRunning + currentRunning * (remainingPeriods + 1),
      workspaceBreakdown: currentWorkspaceBreakdown,
    });
  }

  return rows.sort((a, b) => b.ytdSpentCents - a.ytdSpentCents);
}
