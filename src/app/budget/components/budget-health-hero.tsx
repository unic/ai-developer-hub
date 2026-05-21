import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatVariance } from "@/lib/utils";
import type { BudgetWithCosts } from "@/types";
import type { RunningCostsResult } from "@/lib/budget-utils";
import { StatTile } from "./stat-tile";

interface Props {
  budget: BudgetWithCosts;
  runningCosts: Record<number, RunningCostsResult>;
}

type StatusKind = "no_data" | "under" | "on_track" | "at_risk" | "over";

const STATUS_THRESHOLDS = {
  under: 0.95,
  onTrack: 1.05,
  atRisk: 1.15,
} as const;

function getStatus(actual: number, expected: number, completed: number): StatusKind {
  if (completed === 0 || expected <= 0) return "no_data";
  const ratio = actual / expected;
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

export function BudgetHealthHero({ budget, runningCosts }: Props) {
  const today = new Date();
  const periods = budget.periods;
  const ceiling = budget.totalAmountCents;

  const totals = periods.reduce(
    (a, p) => {
      const start = new Date(p.startDate);
      const end = new Date(p.endDate);
      const isYtd = start <= today;
      const isClosed = end < today;
      const billed = p.billedTotalCents;
      const running = runningCosts[p.id]?.runningCostCents ?? 0;
      const actual = billed + running;
      a.totalPlanned += p.plannedAmountCents;
      if (isYtd) {
        a.ytdPeriodCount += 1;
        a.plannedYtd += p.plannedAmountCents;
        a.expectedYtd += p.expectedSpendCents;
        a.billedYtd += billed;
        a.runningYtd += running;
      }
      if (isClosed && actual > 0) {
        a.closedPeriodCount += 1;
        a.closedActual += actual;
      }
      return a;
    },
    {
      totalPlanned: 0,
      ytdPeriodCount: 0,
      plannedYtd: 0,
      expectedYtd: 0,
      billedYtd: 0,
      runningYtd: 0,
      closedPeriodCount: 0,
      closedActual: 0,
    }
  );

  const actualYtd = totals.billedYtd + totals.runningYtd;
  const unallocated = ceiling - totals.totalPlanned;
  const avgPerClosed =
    totals.closedPeriodCount > 0
      ? totals.closedActual / totals.closedPeriodCount
      : 0;
  const projectedYearEnd =
    totals.closedPeriodCount > 0 ? avgPerClosed * periods.length : actualYtd;
  const projectedVsCeiling = projectedYearEnd - ceiling;
  const expectedVariance = actualYtd - totals.expectedYtd;
  const status = getStatus(actualYtd, totals.expectedYtd, totals.closedPeriodCount);

  const actualPct = ceiling > 0 ? Math.min((actualYtd / ceiling) * 100, 100) : 0;
  const plannedPct =
    ceiling > 0 ? Math.min((totals.plannedYtd / ceiling) * 100, 100) : 0;
  const expectedPct =
    ceiling > 0 ? Math.min((totals.expectedYtd / ceiling) * 100, 100) : 0;
  const unallocatedPct =
    ceiling > 0 ? Math.max((unallocated / ceiling) * 100, 0) : 0;

  const narrative = buildNarrative({
    status,
    expectedVariance,
    projectedVsCeiling,
  });

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusBadgeVariant(status)}>
                {statusLabel(status)}
              </Badge>
              <span className="text-sm text-muted-foreground tabular-nums">
                {formatVariance(expectedVariance)} vs expected YTD
              </span>
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
          expectedPct={expectedPct}
          unallocatedPct={unallocatedPct}
          ceiling={ceiling}
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Billed YTD"
            value={formatCurrency(totals.billedYtd)}
            sub={
              totals.runningYtd > 0
                ? `+ ${formatCurrency(totals.runningYtd)} running API`
                : `${totals.ytdPeriodCount} of ${periods.length} periods`
            }
          />
          <StatTile
            label="Actual YTD"
            value={formatCurrency(actualYtd)}
            sub={`vs ${formatCurrency(totals.expectedYtd)} expected`}
          />
          <StatTile
            label="Projected year-end"
            value={formatCurrency(projectedYearEnd)}
            sub={
              totals.closedPeriodCount > 0
                ? projectedVsCeiling > 0
                  ? `${formatCurrency(projectedVsCeiling)} over ceiling`
                  : `${formatCurrency(Math.abs(projectedVsCeiling))} under ceiling`
                : "Run-rate not yet established"
            }
            tone={projectedVsCeiling > 0 ? "danger" : "default"}
          />
          <StatTile
            label="Variance YTD"
            value={formatVariance(expectedVariance)}
            sub={
              totals.expectedYtd > 0
                ? `${((expectedVariance / totals.expectedYtd) * 100).toFixed(1)}% of expected`
                : null
            }
            tone={expectedVariance > 0 ? "danger" : "default"}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function buildNarrative({
  status,
  expectedVariance,
  projectedVsCeiling,
}: {
  status: StatusKind;
  expectedVariance: number;
  projectedVsCeiling: number;
}): string {
  if (status === "no_data") {
    return "No completed periods yet — projections will appear once at least one period closes.";
  }
  const overUnder =
    expectedVariance >= 0
      ? `${formatCurrency(expectedVariance)} over expected YTD`
      : `${formatCurrency(Math.abs(expectedVariance))} under expected YTD`;
  const projection =
    projectedVsCeiling > 0
      ? `projected to finish ${formatCurrency(projectedVsCeiling)} over the annual ceiling.`
      : `projected to land ${formatCurrency(Math.abs(projectedVsCeiling))} under the ceiling.`;
  const lead = narrativeLead(status);
  return `${lead} ${overUnder}, ${projection}`;
}

function narrativeLead(status: Exclude<StatusKind, "no_data">): string {
  switch (status) {
    case "over":
      return "Spend is running hot —";
    case "at_risk":
      return "Trending above expected —";
    case "under":
      return "Tracking comfortably below expected —";
    case "on_track":
      return "On pace —";
  }
}

function MultiMarkerBar({
  actualPct,
  plannedPct,
  expectedPct,
  unallocatedPct,
  ceiling,
}: {
  actualPct: number;
  plannedPct: number;
  expectedPct: number;
  unallocatedPct: number;
  ceiling: number;
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
        <div
          aria-hidden
          className="absolute inset-y-0 w-px bg-blue-500"
          style={{ left: `${expectedPct}%` }}
          title="Expected YTD"
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <LegendDot className="bg-primary" label="Actual YTD" />
        <LegendDot className="bg-primary/15" label="Allocated remaining" />
        <LegendTick className="bg-foreground/70" label="Planned YTD" />
        <LegendTick className="bg-blue-500" label="Expected YTD" />
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
