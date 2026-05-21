import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatVariance } from "@/lib/utils";
import type { BudgetWithCosts, PeriodWithCosts } from "@/types";
import type { RunningCostsResult } from "@/lib/budget-utils";
import { classifyPeriod } from "@/lib/reports/period-helpers";
import { StatTile } from "./stat-tile";

interface Props {
  budget: BudgetWithCosts;
  runningCosts: Record<number, RunningCostsResult>;
  /**
   * Optional in-progress allocation edits keyed by period id. When omitted,
   * the hero reads `period.plannedAmountCents` (the persisted value). The
   * parent client passes this so the hero's "unallocated" / "planned YTD"
   * figures stay in sync while the user edits the period table.
   */
  allocations?: Record<number, number>;
}

type StatusKind = "no_data" | "under" | "on_track" | "at_risk" | "over";

const STATUS_THRESHOLDS = {
  under: 0.95,
  onTrack: 1.05,
  atRisk: 1.15,
} as const;

/**
 * Below this elapsed fraction we don't trust the current period's burn rate
 * as a projection signal — too few data points to extrapolate honestly.
 */
const MIN_ELAPSED_FRACTION_FOR_PACE = 0.2;

function getStatus(
  closedActual: number,
  closedExpected: number,
  closedCount: number
): StatusKind {
  if (closedCount === 0 || closedExpected <= 0) return "no_data";
  const ratio = closedActual / closedExpected;
  if (ratio < STATUS_THRESHOLDS.under) return "under";
  if (ratio <= STATUS_THRESHOLDS.onTrack) return "on_track";
  if (ratio <= STATUS_THRESHOLDS.atRisk) return "at_risk";
  return "over";
}

function statusLabel(kind: StatusKind): string {
  switch (kind) {
    case "no_data":
      return "No data yet";
    case "under":
      return "Under";
    case "on_track":
      return "On track";
    case "at_risk":
      return "At risk";
    case "over":
      return "Over budget";
  }
}

function statusBadgeVariant(
  kind: StatusKind
): "default" | "secondary" | "destructive" {
  switch (kind) {
    case "over":
    case "at_risk":
      return "destructive";
    case "under":
    case "no_data":
      return "secondary";
    case "on_track":
      return "default";
  }
}

interface CurrentPeriodState {
  period: PeriodWithCosts;
  actual: number;
  /** 0..1 — how far through the current period we are right now. */
  elapsedFraction: number;
  /** `actual / elapsedFraction` once we trust the pace; null otherwise. */
  extrapolated: number | null;
}

function describeCurrent(
  current: CurrentPeriodState,
  avgPerClosed: number
): string {
  const { period, actual, elapsedFraction, extrapolated } = current;
  if (extrapolated === null) {
    return `${period.periodLabel} is ${Math.round(elapsedFraction * 100)}% through (${formatCurrency(actual)} so far).`;
  }
  const delta = extrapolated - avgPerClosed;
  if (avgPerClosed <= 0) {
    return `${period.periodLabel} is on track for ${formatCurrency(extrapolated)} at current pace.`;
  }
  const pct = Math.abs((delta / avgPerClosed) * 100);
  if (Math.abs(delta) < avgPerClosed * 0.05) {
    return `${period.periodLabel} is tracking the historical average (${formatCurrency(extrapolated)} projected).`;
  }
  return delta > 0
    ? `${period.periodLabel} is pacing ${pct.toFixed(0)}% above the historical average (${formatCurrency(extrapolated)} projected vs ${formatCurrency(avgPerClosed)}).`
    : `${period.periodLabel} is pacing ${pct.toFixed(0)}% below the historical average (${formatCurrency(extrapolated)} projected vs ${formatCurrency(avgPerClosed)}).`;
}

export function BudgetHealthHero({ budget, runningCosts, allocations }: Props) {
  const today = new Date();
  const periods = budget.periods;
  const ceiling = budget.totalAmountCents;

  let closedCount = 0;
  let closedActual = 0;
  let closedExpected = 0;
  let totalPlanned = 0;
  let plannedYtd = 0;
  let billedYtd = 0;
  let runningYtd = 0;
  let lastClosed: PeriodWithCosts | null = null;
  let currentRaw: { period: PeriodWithCosts; actual: number } | null = null;

  for (const p of periods) {
    const phase = classifyPeriod(p, today);
    const planned = allocations?.[p.id] ?? p.plannedAmountCents;
    const running = runningCosts[p.id]?.runningCostCents ?? 0;
    const actual = p.billedTotalCents + running;
    totalPlanned += planned;
    if (phase !== "future") {
      plannedYtd += planned;
      billedYtd += p.billedTotalCents;
      runningYtd += running;
    }
    if (phase === "past") {
      closedCount += 1;
      closedActual += actual;
      closedExpected += p.expectedSpendCents;
      if (!lastClosed || p.endDate > lastClosed.endDate) lastClosed = p;
    }
    if (phase === "current") {
      currentRaw = { period: p, actual };
    }
  }

  const actualYtd = billedYtd + runningYtd;
  const unallocated = ceiling - totalPlanned;
  const avgPerClosed = closedCount > 0 ? closedActual / closedCount : 0;

  const current: CurrentPeriodState | null = currentRaw
    ? buildCurrentState(currentRaw, today)
    : null;

  // Anchored projection: actuals already in the books + an honest estimate
  // for the in-progress period + average for everything still ahead.
  const remainingCount = periods.length - closedCount - (current ? 1 : 0);
  const currentContribution = current
    ? current.extrapolated !== null
      ? Math.max(current.extrapolated, avgPerClosed)
      : avgPerClosed
    : 0;
  const projectedYearEnd =
    closedCount > 0
      ? closedActual + currentContribution + remainingCount * avgPerClosed
      : actualYtd;
  const projectedVsCeiling = projectedYearEnd - ceiling;

  // Variance is closed-only — the current period drags the YTD comparison
  // because its full expected lands on day one against a partial actual.
  const closedVariance = closedActual - closedExpected;
  const status = getStatus(closedActual, closedExpected, closedCount);

  const actualPct = ceiling > 0 ? Math.min((actualYtd / ceiling) * 100, 100) : 0;
  const plannedPct = ceiling > 0 ? Math.min((plannedYtd / ceiling) * 100, 100) : 0;
  // Expected marker reflects the closed window — the same scope as the
  // variance tile and the status pill, so they read consistently.
  const closedExpectedPct =
    ceiling > 0 ? Math.min((closedExpected / ceiling) * 100, 100) : 0;
  const unallocatedPct =
    ceiling > 0 ? Math.max((unallocated / ceiling) * 100, 0) : 0;

  const narrative = buildNarrative({
    status,
    closedVariance,
    projectedVsCeiling,
    lastClosedLabel: lastClosed?.periodLabel ?? null,
    current,
    avgPerClosed,
  });

  const varianceLabel = lastClosed
    ? `Variance through ${lastClosed.periodLabel}`
    : "Variance";

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusBadgeVariant(status)}>
                {statusLabel(status)}
              </Badge>
              {lastClosed && (
                <span className="text-sm text-muted-foreground tabular-nums">
                  {formatVariance(closedVariance)} through {lastClosed.periodLabel}
                </span>
              )}
            </div>
            <p className="max-w-xl text-sm text-muted-foreground leading-relaxed">
              {narrative}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Annual ceiling
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatCurrency(ceiling)}
            </p>
            {unallocated !== 0 && (
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                {unallocated > 0
                  ? `${formatCurrency(unallocated)} unallocated`
                  : `${formatCurrency(Math.abs(unallocated))} over-allocated`}
              </p>
            )}
          </div>
        </div>

        <MultiMarkerBar
          actualPct={actualPct}
          plannedPct={plannedPct}
          closedExpectedPct={closedExpectedPct}
          unallocatedPct={unallocatedPct}
          ceiling={ceiling}
          lastClosedLabel={lastClosed?.periodLabel ?? null}
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Billed YTD"
            value={formatCurrency(billedYtd)}
            sub={
              runningYtd > 0
                ? `+ ${formatCurrency(runningYtd)} running API`
                : `${closedCount + (current ? 1 : 0)} of ${periods.length} periods`
            }
          />
          <StatTile
            label="Actual YTD"
            value={formatCurrency(actualYtd)}
            sub={
              current
                ? `${formatCurrency(current.actual)} in ${current.period.periodLabel} so far`
                : null
            }
          />
          <StatTile
            label="Projected year-end"
            value={formatCurrency(projectedYearEnd)}
            sub={
              closedCount > 0
                ? projectedVsCeiling > 0
                  ? `${formatCurrency(projectedVsCeiling)} over ceiling`
                  : `${formatCurrency(Math.abs(projectedVsCeiling))} under ceiling`
                : "Run-rate not yet established"
            }
            tone={projectedVsCeiling > 0 ? "danger" : "default"}
          />
          <StatTile
            label={varianceLabel}
            value={lastClosed ? formatVariance(closedVariance) : "—"}
            sub={
              lastClosed && closedExpected > 0
                ? `${formatCurrency(closedActual)} vs ${formatCurrency(closedExpected)} expected`
                : lastClosed
                  ? "No expected baseline"
                  : "No closed periods yet"
            }
            tone={closedVariance > 0 ? "danger" : "default"}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function buildCurrentState(
  raw: { period: PeriodWithCosts; actual: number },
  today: Date
): CurrentPeriodState {
  const startMs = new Date(raw.period.startDate + "T00:00:00Z").getTime();
  const endExclusiveMs =
    new Date(raw.period.endDate + "T00:00:00Z").getTime() + 86_400_000;
  const totalMs = endExclusiveMs - startMs;
  const elapsedMs = Math.max(0, Math.min(today.getTime() - startMs, totalMs));
  const elapsedFraction = totalMs > 0 ? elapsedMs / totalMs : 0;
  const extrapolated =
    elapsedFraction >= MIN_ELAPSED_FRACTION_FOR_PACE
      ? raw.actual / elapsedFraction
      : null;
  return { ...raw, elapsedFraction, extrapolated };
}

function buildNarrative({
  status,
  closedVariance,
  projectedVsCeiling,
  lastClosedLabel,
  current,
  avgPerClosed,
}: {
  status: StatusKind;
  closedVariance: number;
  projectedVsCeiling: number;
  lastClosedLabel: string | null;
  current: CurrentPeriodState | null;
  avgPerClosed: number;
}): string {
  if (status === "no_data") {
    const head =
      "No completed periods yet — variance and projection appear once a period closes.";
    if (current) {
      return `${head} ${describeCurrent(current, avgPerClosed)}`;
    }
    return head;
  }
  const overUnder =
    closedVariance >= 0
      ? `${formatCurrency(closedVariance)} over expected through ${lastClosedLabel}`
      : `${formatCurrency(Math.abs(closedVariance))} under expected through ${lastClosedLabel}`;
  const projection =
    projectedVsCeiling > 0
      ? `projected to finish ${formatCurrency(projectedVsCeiling)} over the annual ceiling.`
      : `projected to land ${formatCurrency(Math.abs(projectedVsCeiling))} under the ceiling.`;
  const lead = narrativeLead(status);
  const closedSentence = `${lead} ${overUnder}, ${projection}`;
  if (current) {
    return `${closedSentence} ${describeCurrent(current, avgPerClosed)}`;
  }
  return closedSentence;
}

function narrativeLead(status: Exclude<StatusKind, "no_data">): string {
  switch (status) {
    case "over":
      return "Spend ran hot through the closed window —";
    case "at_risk":
      return "Trending above expected through the closed window —";
    case "under":
      return "Tracking comfortably below expected through the closed window —";
    case "on_track":
      return "On pace through the closed window —";
  }
}

function MultiMarkerBar({
  actualPct,
  plannedPct,
  closedExpectedPct,
  unallocatedPct,
  ceiling,
  lastClosedLabel,
}: {
  actualPct: number;
  plannedPct: number;
  closedExpectedPct: number;
  unallocatedPct: number;
  ceiling: number;
  lastClosedLabel: string | null;
}) {
  const allocatedPct = Math.max(100 - unallocatedPct, 0);
  return (
    <div className="space-y-3">
      <div className="relative h-7 w-full overflow-hidden rounded-md bg-muted/40 border">
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 bg-primary/15"
          style={{ width: `${allocatedPct}%` }}
        />
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 bg-primary"
          style={{ width: `${actualPct}%` }}
        />
        <div
          aria-hidden
          className="absolute inset-y-0 w-px bg-foreground/70"
          style={{ left: `${plannedPct}%` }}
          title="Planned YTD"
        />
        {lastClosedLabel && (
          <div
            aria-hidden
            className="absolute inset-y-0 w-px bg-blue-500"
            style={{ left: `${closedExpectedPct}%` }}
            title={`Expected through ${lastClosedLabel}`}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <LegendDot className="bg-primary" label="Actual YTD" />
        <LegendDot className="bg-primary/15" label="Allocated remaining" />
        <LegendTick className="bg-foreground/70" label="Planned YTD" />
        {lastClosedLabel && (
          <LegendTick
            className="bg-blue-500"
            label={`Expected through ${lastClosedLabel}`}
          />
        )}
        <span className="ml-auto tabular-nums">
          Ceiling {formatCurrency(ceiling)}
        </span>
      </div>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`inline-block size-2 rounded-sm ${className}`}
        aria-hidden
      />
      {label}
    </span>
  );
}

function LegendTick({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-3 w-px ${className}`} aria-hidden />
      {label}
    </span>
  );
}
