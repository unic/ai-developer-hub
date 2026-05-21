import type { BudgetForecast, ReportOverviewData } from "@/types";

export type PeriodPhase = "past" | "current" | "future";

/**
 * Trend direction + magnitude between the two most recent billed periods.
 * Used by the Reports Overview page and the admin dashboard's KPI grid.
 */
export function computeSpendTrend(historicalPeriods: { billedCents: number }[]): {
  spendTrend: ReportOverviewData["spendTrend"];
  spendTrendPct: number;
} {
  const lastTwo = historicalPeriods.slice(-2);
  if (lastTwo.length < 2 || lastTwo[0].billedCents === 0) {
    return { spendTrend: "flat", spendTrendPct: 0 };
  }
  const diff = lastTwo[1].billedCents - lastTwo[0].billedCents;
  const pct = (diff / lastTwo[0].billedCents) * 100;
  if (Math.abs(pct) < 1) return { spendTrend: "flat", spendTrendPct: pct };
  return { spendTrend: diff > 0 ? "up" : "down", spendTrendPct: pct };
}

export function classifyPeriod(
  period: { startDate: string; endDate: string },
  now: Date = new Date()
): PeriodPhase {
  // `budget_periods.end_date` is a DATE (no time) representing the last
  // calendar day of the period. Treat it as inclusive end-of-day so a period
  // doesn't flip to "past" the moment its final day starts.
  const endExclusive = new Date(period.endDate + "T00:00:00Z");
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  if (now >= endExclusive) return "past";
  if (new Date(period.startDate + "T00:00:00Z") <= now) return "current";
  return "future";
}

export interface ProjectionLookup {
  /** Forecast for a given period label, falling back to the average projected month. */
  for(periodLabel: string): number;
  avgProjectedMonthly: number;
}

export function buildProjectionLookup(forecast: BudgetForecast): ProjectionLookup {
  const byMonth = new Map(
    forecast.projections.map((p) => [p.month, p.projectedAmountCents])
  );
  const avgProjectedMonthly =
    forecast.projections.length > 0
      ? forecast.projections.reduce(
          (s, p) => s + p.projectedAmountCents,
          0
        ) / forecast.projections.length
      : 0;
  return {
    for: (label) => byMonth.get(label) ?? avgProjectedMonthly,
    avgProjectedMonthly,
  };
}

/** "Apr 2026" → "Apr"; "Q1 2026" → "Q1". */
export function shortMonth(label: string): string {
  return label.split(" ")[0];
}
