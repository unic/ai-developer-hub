import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCurrency, formatVariance } from "@/lib/utils";
import type { BudgetWithCosts } from "@/types";
import type { RunningCostsResult } from "@/lib/budget-utils";
import { StatTile } from "./stat-tile";

interface Props {
  budget: BudgetWithCosts;
  runningCosts: Record<number, RunningCostsResult>;
}

export function PastMonthSpotlight({ budget, runningCosts }: Props) {
  const today = new Date();
  let latest: { period: BudgetWithCosts["periods"][number]; endTime: number; actual: number } | null = null;
  for (const p of budget.periods) {
    const end = new Date(p.endDate);
    if (end >= today) continue;
    const running = runningCosts[p.id]?.runningCostCents ?? 0;
    const actual = p.billedTotalCents + running;
    if (actual <= 0) continue;
    const endTime = end.getTime();
    if (!latest || endTime > latest.endTime) {
      latest = { period: p, endTime, actual };
    }
  }
  if (!latest) return null;

  const { period } = latest;
  const planned = period.plannedAmountCents;
  const expected = period.expectedSpendCents;
  const billed = period.billedTotalCents;
  const running = runningCosts[period.id]?.runningCostCents ?? 0;
  const actual = latest.actual;
  const variance = actual - expected;
  const variancePct = expected > 0 ? (variance / expected) * 100 : null;
  const overExpected = variance > 0;

  const inlineSplit =
    running > 0
      ? `${formatCurrency(billed)} billed + ${formatCurrency(running)} API`
      : `${formatCurrency(billed)} billed`;

  return (
    <Card>
      <CardHeader>
        <CardDescription className="uppercase tracking-wide text-xs">
          Past month spotlight
        </CardDescription>
        <CardTitle>
          {period.periodLabel} —{" "}
          <span className="tabular-nums">{formatCurrency(actual)}</span> actual
          vs <span className="tabular-nums">{formatCurrency(planned)}</span>{" "}
          planned
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-4">
          <StatTile
            label="Planned"
            value={formatCurrency(planned)}
            sub="Allocated"
          />
          <StatTile
            label="Expected"
            value={formatCurrency(expected)}
            sub="From license assignments"
          />
          <StatTile
            label="Actual"
            value={formatCurrency(actual)}
            sub={inlineSplit}
            tone={overExpected ? "danger" : "default"}
          />
          <StatTile
            label="Variance"
            value={
              variancePct !== null
                ? `${variancePct >= 0 ? "+" : ""}${variancePct.toFixed(1)}%`
                : "—"
            }
            sub={`${formatVariance(variance)} vs expected`}
            tone={overExpected ? "danger" : "success"}
          />
        </div>
      </CardContent>
    </Card>
  );
}
