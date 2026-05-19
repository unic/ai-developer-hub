import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import type { BudgetForecast, BudgetWithCosts, PeriodWithActual } from "@/types";

interface AtAGlanceProps {
  budget: BudgetWithCosts;
  periods: PeriodWithActual[];
  forecast: BudgetForecast;
}

export function AtAGlance({ budget, periods, forecast }: AtAGlanceProps) {
  const today = new Date();
  const completedPeriods = periods.filter(
    (p) => new Date(p.endDate) < today && p.actualCents > 0
  );
  const billedYtd = periods
    .filter((p) => new Date(p.startDate) <= today)
    .reduce((s, p) => s + p.billedTotalCents, 0);
  const runningYtd = periods
    .filter((p) => new Date(p.startDate) <= today)
    .reduce((s, p) => s + p.runningCostCents, 0);
  const actualYtd = billedYtd + runningYtd;
  const ceiling = budget.totalAmountCents;
  const utilizationPct = ceiling > 0 ? (actualYtd / ceiling) * 100 : 0;
  const avgRunRate =
    completedPeriods.length > 0
      ? completedPeriods.reduce((s, p) => s + p.actualCents, 0) /
        completedPeriods.length
      : 0;
  const monthlyPlan =
    periods.length > 0
      ? periods.reduce((s, p) => s + p.plannedAmountCents, 0) / periods.length
      : 0;

  const atRisk = forecast.status === "at_risk";
  const overage = forecast.projectedAnnualTotalCents - ceiling;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>FY {budget.fiscalYear} budget at a glance</CardTitle>
          <CardDescription>
            {completedPeriods.length} of {periods.length} periods complete · Actual ={" "}
            <span className="font-medium">billed + running API</span>
          </CardDescription>
        </div>
        <Badge variant={atRisk ? "destructive" : "default"}>
          {atRisk
            ? `At risk · projected ${formatCurrency(overage)} over`
            : "On track"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        <ProgressBar
          actualYtd={actualYtd}
          ceiling={ceiling}
          projectedAnnualTotal={forecast.projectedAnnualTotalCents}
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Annual ceiling"
            value={formatCurrency(ceiling)}
            sub={
              periods.length > 0
                ? `${periods.length} × ${formatCurrency(monthlyPlan)} planned`
                : null
            }
          />
          <StatTile
            label="Actual YTD"
            value={formatCurrency(actualYtd)}
            sub={
              runningYtd > 0
                ? `${formatCurrency(billedYtd)} billed + ${formatCurrency(runningYtd)} API`
                : `${formatCurrency(billedYtd)} billed`
            }
          />
          <StatTile
            label="Avg monthly run-rate"
            value={formatCurrency(avgRunRate)}
            sub={
              monthlyPlan > 0
                ? `vs ${formatCurrency(monthlyPlan)} planned${
                    avgRunRate > monthlyPlan
                      ? ` (+${(((avgRunRate - monthlyPlan) / monthlyPlan) * 100).toFixed(1)}%)`
                      : avgRunRate < monthlyPlan
                        ? ` (−${(((monthlyPlan - avgRunRate) / monthlyPlan) * 100).toFixed(1)}%)`
                        : ""
                  }`
                : null
            }
          />
          <StatTile
            label="Projected year-end"
            value={formatCurrency(forecast.projectedAnnualTotalCents)}
            sub={
              atRisk
                ? `${formatCurrency(overage)} over (linear trend)`
                : `within ${formatCurrency(ceiling)} ceiling`
            }
            highlight={atRisk}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Utilization: <span className="font-medium">{utilizationPct.toFixed(1)}%</span> of ceiling consumed YTD
        </p>
      </CardContent>
    </Card>
  );
}

function StatTile({
  label,
  value,
  sub,
  highlight = false,
}: {
  label: string;
  value: string;
  sub?: string | null;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card/60 p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          highlight ? "text-destructive" : ""
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function ProgressBar({
  actualYtd,
  ceiling,
  projectedAnnualTotal,
}: {
  actualYtd: number;
  ceiling: number;
  projectedAnnualTotal: number;
}) {
  if (ceiling === 0) return null;
  // When projected exceeds the ceiling, scale the bar to fit the projected
  // total instead of the ceiling so the overage stays inside the card. The
  // ceiling becomes a tick mark inside the bar.
  const scale = Math.max(ceiling, projectedAnnualTotal);
  const actualPct = (actualYtd / scale) * 100;
  const projectedPct = (projectedAnnualTotal / scale) * 100;
  const ceilingPct = (ceiling / scale) * 100;
  const over = projectedAnnualTotal > ceiling;

  return (
    <div>
      <div className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span>$0</span>
        <span>
          <span className="font-medium text-foreground">
            {formatCurrency(scale)}
          </span>{" "}
          {over ? "projected" : "ceiling"}
        </span>
      </div>
      <div className="relative mt-2 pt-4">
        <div className="relative h-3 overflow-hidden rounded-full bg-muted">
          {over && (
            <div
              className="absolute inset-y-0 left-0 bg-destructive/40"
              style={{ width: `${projectedPct}%` }}
              aria-hidden
            />
          )}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary"
            style={{ width: `${actualPct}%` }}
            aria-label={`Actual ${((actualYtd / ceiling) * 100).toFixed(1)}% of ceiling`}
          />
        </div>
        {over && (
          <div
            className="pointer-events-none absolute -top-1 bottom-0 flex flex-col items-center"
            style={{ left: `${ceilingPct}%`, transform: "translateX(-50%)" }}
            aria-hidden
            title={`Ceiling ${formatCurrency(ceiling)}`}
          >
            <span className="mb-0.5 whitespace-nowrap rounded bg-foreground px-1.5 py-px text-[10px] font-medium leading-none text-background">
              ceiling {formatCurrency(ceiling)}
            </span>
            <div className="w-0.5 flex-1 bg-foreground" />
          </div>
        )}
      </div>
    </div>
  );
}
