import type {
  BudgetForecast,
  BudgetWithCosts,
  ForecastPoint,
  MonthlySpend,
} from "@/types";

export interface ForecastOptions {
  history: MonthlySpend[];
  monthsToProject?: number;
  totalPeriodsRemaining?: number;
  actualSpendToDateCents: number;
  /** The live (extended) ceiling — used for at-risk evaluation and the main ceiling line. */
  budgetCeilingCents: number;
  /**
   * The original (pre-extension) ceiling. Equal to budgetCeilingCents when the
   * budget has not been extended. Surfaced so the forecast chart can render a
   * dashed reference line at the original baseline. Defaults to budgetCeilingCents
   * when omitted (the un-extended case, which is what unit tests want).
   */
  originalCeilingCents?: number;
  today: Date;
}

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function parseMonthLabel(label: string): { year: number; month: number } | null {
  // "MMM YYYY" (e.g. "Jan 2026")
  const parts = label.split(" ");
  if (parts.length === 2) {
    const monthIdx = MONTH_NAMES.indexOf(parts[0]);
    const year = parseInt(parts[1], 10);
    if (monthIdx !== -1 && !isNaN(year)) return { year, month: monthIdx };
  }
  // "Qn YYYY" (e.g. "Q1 2026")
  const quarterMatch = label.match(/^Q([1-4])\s+(\d{4})$/);
  if (quarterMatch) {
    const quarter = parseInt(quarterMatch[1], 10);
    const year = parseInt(quarterMatch[2], 10);
    return { year, month: (quarter - 1) * 3 };
  }
  return null;
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
  const {
    history,
    actualSpendToDateCents,
    budgetCeilingCents,
    today,
  } = options;
  const originalCeilingCents =
    options.originalCeilingCents ?? budgetCeilingCents;
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
      originalCeilingCents,
      status: projectedAnnualTotalCents <= budgetCeilingCents ? "on_track" : "at_risk",
      insufficientData: `Need at least 3 months of history (currently ${history.length})`,
    };
  }

  const annualProjectionCount = options.totalPeriodsRemaining !== undefined
    ? Math.max(options.totalPeriodsRemaining, monthsToProject)
    : monthsToProject;

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

  let projectedRemainingCents = 0;
  for (let i = 0; i < annualProjectionCount; i++) {
    const rawAmount = slope * (baseX + i) + intercept;
    projectedRemainingCents += Math.max(0, Math.round(rawAmount));
  }
  const projectedAnnualTotalCents = actualSpendToDateCents + projectedRemainingCents;

  return {
    slopeCents: Math.round(slope),
    interceptCents: Math.round(intercept),
    projections,
    projectedRemainingCents,
    actualSpendToDateCents,
    projectedAnnualTotalCents,
    budgetCeilingCents,
    originalCeilingCents,
    status: projectedAnnualTotalCents <= budgetCeilingCents ? "on_track" : "at_risk",
  };
}

/**
 * Derive a forecast from already-fetched budget data + an Actual-per-period
 * map (billed + running). Lets the reports orchestrator share one fetch with
 * `getBudgetForecast` instead of re-querying running costs.
 */
export function buildBudgetForecast(
  budget: BudgetWithCosts,
  actualByPeriod: Map<number, number>,
  today: Date = new Date()
): BudgetForecast {
  const completedPeriods = budget.periods.filter(
    (p) => new Date(p.endDate) < today && (actualByPeriod.get(p.id) ?? 0) > 0
  );
  const history: MonthlySpend[] = completedPeriods.map((p) => ({
    month: p.periodLabel,
    amountCents: actualByPeriod.get(p.id) ?? 0,
  }));
  const actualSpendToDateCents = completedPeriods.reduce(
    (s, p) => s + (actualByPeriod.get(p.id) ?? 0),
    0
  );
  const remainingPeriods = budget.periods.filter(
    (p) => new Date(p.startDate) >= today
  );
  return forecastBudget({
    history,
    monthsToProject: Math.min(Math.max(remainingPeriods.length, 3), 6),
    totalPeriodsRemaining: remainingPeriods.length,
    actualSpendToDateCents,
    budgetCeilingCents: budget.totalAmountCents,
    originalCeilingCents: budget.originalAmountCents,
    today,
  });
}
