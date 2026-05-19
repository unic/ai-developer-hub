import type { BudgetForecast } from "@/types";

export type PeriodPhase = "past" | "current" | "future";

export function classifyPeriod(
  period: { startDate: string; endDate: string },
  now: Date = new Date()
): PeriodPhase {
  if (new Date(period.endDate) < now) return "past";
  if (new Date(period.startDate) <= now) return "current";
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
