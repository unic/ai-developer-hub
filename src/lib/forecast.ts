import type { MonthlySpend, ForecastPoint, BudgetForecast } from "@/types";

export interface ForecastOptions {
  history: MonthlySpend[];
  monthsToProject?: number;
  actualSpendToDateCents: number;
  budgetCeilingCents: number;
  today: Date;
}

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function parseMonthLabel(label: string): { year: number; month: number } | null {
  const parts = label.split(" ");
  if (parts.length !== 2) return null;
  const monthIdx = MONTH_NAMES.indexOf(parts[0]);
  const year = parseInt(parts[1], 10);
  if (monthIdx === -1 || isNaN(year)) return null;
  return { year, month: monthIdx };
}

function formatMonthLabel(year: number, monthIdx: number): string {
  return `${MONTH_NAMES[monthIdx]} ${year}`;
}

function nextMonth(year: number, monthIdx: number): { year: number; month: number } {
  if (monthIdx === 11) return { year: year + 1, month: 0 };
  return { year, month: monthIdx + 1 };
}

function olsRegression(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length;
  const sumX = xs.reduce((s, x) => s + x, 0);
  const sumY = ys.reduce((s, y) => s + y, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumXX = xs.reduce((s, x) => s + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: n > 0 ? sumY / n : 0 };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

export function forecastBudget(options: ForecastOptions): BudgetForecast {
  const { history, actualSpendToDateCents, budgetCeilingCents, today } = options;
  const monthsToProject = Math.min(Math.max(options.monthsToProject ?? 3, 3), 6);

  if (history.length < 3) {
    const projectedAnnualTotalCents = actualSpendToDateCents;
    return {
      slopeCents: 0,
      interceptCents: 0,
      projections: [],
      projectedRemainingCents: 0,
      actualSpendToDateCents,
      projectedAnnualTotalCents,
      budgetCeilingCents,
      status: projectedAnnualTotalCents <= budgetCeilingCents ? "on_track" : "at_risk",
      insufficientData: `Need at least 3 months of history (currently ${history.length})`,
    };
  }

  const xs = history.map((_, i) => i);
  const ys = history.map((h) => h.amountCents);
  const { slope, intercept } = olsRegression(xs, ys);

  // Determine start month for projections from last history month
  const lastEntry = history[history.length - 1];
  const lastParsed = parseMonthLabel(lastEntry.month) ?? {
    year: today.getFullYear(),
    month: today.getMonth(),
  };

  const projections: ForecastPoint[] = [];
  let cur = nextMonth(lastParsed.year, lastParsed.month);
  const baseX = history.length; // x index for first projected month

  for (let i = 0; i < monthsToProject; i++) {
    const rawAmount = slope * (baseX + i) + intercept;
    projections.push({
      month: formatMonthLabel(cur.year, cur.month),
      projectedAmountCents: Math.max(0, Math.round(rawAmount)),
    });
    cur = nextMonth(cur.year, cur.month);
  }

  const projectedRemainingCents = projections.reduce(
    (s, p) => s + p.projectedAmountCents,
    0
  );
  const projectedAnnualTotalCents = actualSpendToDateCents + projectedRemainingCents;

  return {
    slopeCents: Math.round(slope),
    interceptCents: Math.round(intercept),
    projections,
    projectedRemainingCents,
    actualSpendToDateCents,
    projectedAnnualTotalCents,
    budgetCeilingCents,
    status: projectedAnnualTotalCents <= budgetCeilingCents ? "on_track" : "at_risk",
  };
}
