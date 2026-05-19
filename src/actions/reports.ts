"use server";

import { db } from "@/lib/db";
import { aiTools, licenseAssignments } from "@/lib/db/schema";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import {
  getActiveBudget,
  getBudgetForecast,
  getBudgetWithCosts,
} from "@/actions/budget";
import { getRunningCostsForPeriod } from "@/lib/budget-utils";
import type {
  BudgetPerToolRow,
  BudgetReportData,
  BudgetReportPastMonth,
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
  if (!active) {
    return { kind: "empty", reason: "no_active_budget" };
  }

  const budget = await getBudgetWithCosts(active.id);
  if (!budget) {
    return { kind: "empty", reason: "no_active_budget" };
  }

  // Run independent fetches in parallel.
  const [runningResults, forecastResult] = await Promise.all([
    Promise.all(budget.periods.map((p) => getRunningCostsForPeriod(p.id))),
    getBudgetForecast(budget.id),
  ]);

  const runningByPeriod = new Map<number, ReturnType<typeof toRunningSlice>>();
  budget.periods.forEach((p, i) => {
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

  const forecast =
    forecastResult.success && forecastResult.data
      ? forecastResult.data
      : null;

  // Forecast is required for the Budget tab; getBudgetForecast only fails when the
  // budget was deleted between the two queries above (effectively unreachable).
  if (!forecast) {
    return { kind: "empty", reason: "no_active_budget" };
  }

  const pastMonth = await buildPastMonth(periodsWithActual);

  const perTool = await buildPerToolBreakdown(
    periodsWithActual,
    runningByPeriod
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

async function buildPastMonth(
  periods: PeriodWithActual[]
): Promise<BudgetReportPastMonth | null> {
  const today = new Date();
  const past = periods
    .filter((p) => new Date(p.endDate) < today && p.actualCents > 0)
    .at(-1);
  if (!past) return null;

  const priorIndex = periods.findIndex((p) => p.id === past.id) - 1;
  const prior = priorIndex >= 0 ? periods[priorIndex] : null;

  const variance = past.actualCents - past.plannedAmountCents;
  const variancePct =
    past.plannedAmountCents > 0
      ? (variance / past.plannedAmountCents) * 100
      : null;

  const drivers = await buildVarianceDrivers(past, prior);

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

async function buildVarianceDrivers(
  past: PeriodWithActual,
  prior: PeriodWithActual | null
): Promise<BudgetReportPastMonth["drivers"]> {
  if (!prior) return [];

  const [pastTools, priorTools] = await Promise.all([
    perToolForPeriod(past.startDate, past.endDate),
    perToolForPeriod(prior.startDate, prior.endDate),
  ]);

  const priorByTool = new Map(priorTools.map((t) => [t.toolId, t]));
  const deltas: BudgetReportPastMonth["drivers"] = [];

  for (const t of pastTools) {
    const priorCents = priorByTool.get(t.toolId)?.totalCents ?? 0;
    const delta = t.totalCents - priorCents;
    if (Math.abs(delta) < 1) continue;
    deltas.push({
      toolId: t.toolId,
      toolName: t.toolName,
      deltaCents: delta,
      deltaPct: priorCents > 0 ? (delta / priorCents) * 100 : null,
    });
  }

  // Tools that existed prior but not in past — full off-boarding.
  for (const t of priorTools) {
    if (pastTools.some((p) => p.toolId === t.toolId)) continue;
    deltas.push({
      toolId: t.toolId,
      toolName: t.toolName,
      deltaCents: -t.totalCents,
      deltaPct: -100,
    });
  }

  return deltas
    .sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents))
    .slice(0, 5);
}

async function perToolForPeriod(
  startDate: string,
  endDate: string
): Promise<Array<{ toolId: number; toolName: string; totalCents: number }>> {
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
        lte(licenseAssignments.assignedAt, new Date(endDate)),
        or(
          isNull(licenseAssignments.revokedAt),
          gte(licenseAssignments.revokedAt, new Date(startDate))
        )
      )
    );

  const tally = new Map<number, { toolName: string; cents: number }>();
  for (const r of rows) {
    const existing = tally.get(r.toolId);
    if (existing) {
      existing.cents += r.costAtAssignmentCents;
    } else {
      tally.set(r.toolId, {
        toolName: r.toolName,
        cents: r.costAtAssignmentCents,
      });
    }
  }
  return Array.from(tally.entries()).map(([toolId, { toolName, cents }]) => ({
    toolId,
    toolName,
    totalCents: cents,
  }));
}

async function buildPerToolBreakdown(
  periods: PeriodWithActual[],
  runningByPeriod: Map<number, RunningSlice>
): Promise<BudgetPerToolRow[]> {
  const today = new Date();
  const completedPeriods = periods.filter(
    (p) => new Date(p.endDate) < today
  );
  const currentPeriod = periods.find(
    (p) => new Date(p.startDate) <= today && new Date(p.endDate) >= today
  );

  // YTD per-tool (license-derived).
  const ytdByTool = new Map<number, { toolName: string; cents: number }>();
  for (const p of completedPeriods) {
    const rows = await perToolForPeriod(p.startDate, p.endDate);
    for (const r of rows) {
      const existing = ytdByTool.get(r.toolId);
      if (existing) {
        existing.cents += r.totalCents;
      } else {
        ytdByTool.set(r.toolId, { toolName: r.toolName, cents: r.totalCents });
      }
    }
  }

  // Current monthly per tool (used for projection).
  const currentRows = currentPeriod
    ? await perToolForPeriod(currentPeriod.startDate, currentPeriod.endDate)
    : [];
  const currentByTool = new Map(
    currentRows.map((r) => [r.toolId, r.totalCents])
  );

  const remainingPeriods = periods.filter(
    (p) => new Date(p.startDate) > today
  ).length;

  const rows: BudgetPerToolRow[] = [];

  // License-based tools.
  for (const [toolId, { toolName, cents: ytd }] of ytdByTool) {
    const current = currentByTool.get(toolId) ?? 0;
    rows.push({
      toolId,
      toolName,
      isAnthropicApi: false,
      ytdSpentCents: ytd,
      currentMonthlyCents: current,
      projectedEoyCents: ytd + current * (remainingPeriods + 1),
    });
  }
  // Tools active only this month (not in any completed period yet).
  for (const [toolId, current] of currentByTool) {
    if (ytdByTool.has(toolId)) continue;
    const toolName = currentRows.find((r) => r.toolId === toolId)?.toolName ?? "—";
    rows.push({
      toolId,
      toolName,
      isAnthropicApi: false,
      ytdSpentCents: 0,
      currentMonthlyCents: current,
      projectedEoyCents: current * (remainingPeriods + 1),
    });
  }

  // Anthropic API — aggregate running costs across completed periods + workspace breakdown of the current period.
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
