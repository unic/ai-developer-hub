/**
 * What a tool is expected to cost in a budget period.
 *
 * A seat price and an allowance are different kinds of number, and summing
 * them as if they were the same is the mistake this module exists to end. For
 * a seat tier the tier price IS the cost — you pay it whether or not the seat
 * is used. For a usage tier the price is an allowance: how much that person
 * MAY spend. Forecasting the allowance over-predicts by roughly 10x on the
 * current portfolio ($3,650/month of Claude Console allowances against $398.69
 * of actual August consumption).
 *
 * Pure — no database, no clock. Rules are P1-P8 in
 * specs/045-usage-based-cost-model/contracts/pricing-and-credits.md.
 */

import { overlapsPeriod, type AssignmentCostWindow } from "@/lib/budget-utils";

export type PricingModel = "seat" | "usage";

/** Where an expected-spend figure came from — always reported with it (P7). */
export type ExpectedSpendBasis =
  | "tier_price"
  | "measured"
  | "projected"
  | "allowance_fallback";

export interface ExpectedSpend {
  cents: number;
  basis: ExpectedSpendBasis;
}

/**
 * How many complete months feed a projection (P5, spec OQ-2).
 *
 * Three rather than one: consumption swings widely month to month — $3,016.86
 * in June 2026 against $194.89 in July — and a single-month window would let
 * one heavy month dominate the rest of the year.
 */
export const PROJECTION_MONTHS = 3;

export interface ExpectedSpendInput {
  pricingModel: PricingModel;
  /** Assignments for this tool, with their held window and price/allowance. */
  assignments: readonly AssignmentCostWindow[];
  /** Measured consumption in cents, keyed YYYY-MM. Complete months only. */
  measuredByMonth: ReadonlyMap<string, number>;
  period: {
    start: Date;
    end: Date;
    /** True once the period has ended — a partial period is never "measured". */
    isComplete: boolean;
    /** The YYYY-MM months this period spans, in order. */
    months: readonly string[];
  };
}

/** The allowance (or seat price) of every assignment overlapping the period. */
function sumAssignmentPrices(input: ExpectedSpendInput): number {
  return input.assignments
    .filter((a) => overlapsPeriod(a, input.period.start, input.period.end))
    .reduce((total, a) => total + a.costAtAssignmentCents, 0);
}

/**
 * Mean consumption over the most recent complete months that have data.
 *
 * Months with no data at all are skipped rather than counted as zero: a month
 * the Hub never synced is not evidence of a month with no spend. Partial
 * months are never passed in (P6) — a half-month would drag the mean down.
 */
function projectFromHistory(
  measuredByMonth: ReadonlyMap<string, number>,
  before: string,
): number | null {
  const months = [...measuredByMonth.keys()]
    .filter((m) => m < before)
    .sort()
    .slice(-PROJECTION_MONTHS);

  if (months.length === 0) return null;

  const total = months.reduce((sum, m) => sum + (measuredByMonth.get(m) ?? 0), 0);
  return Math.round(total / months.length);
}

/**
 * Expected spend for one tool in one period.
 *
 * Seat tiers take the first branch and never touch the rest of this function —
 * their arithmetic is exactly what it was before this feature (P1).
 */
export function expectedSpendForPeriod(
  input: ExpectedSpendInput,
): ExpectedSpend {
  if (input.pricingModel === "seat") {
    return { cents: sumAssignmentPrices(input), basis: "tier_price" };
  }

  const { measuredByMonth, period } = input;

  // A completed period with data has a right answer; use it.
  if (period.isComplete) {
    const measured = period.months
      .filter((m) => measuredByMonth.has(m))
      .reduce((sum, m) => sum + (measuredByMonth.get(m) ?? 0), 0);
    if (period.months.some((m) => measuredByMonth.has(m))) {
      return { cents: measured, basis: "measured" };
    }
  }

  // Open or future period: project from recent complete months.
  const firstMonth = period.months[0] ?? "";
  const projected = projectFromHistory(measuredByMonth, firstMonth);
  if (projected !== null) {
    // A period spanning several months projects each of them.
    return {
      cents: projected * Math.max(1, period.months.length),
      basis: "projected",
    };
  }

  // Nothing measured, ever. The allowance is a poor predictor, so it is
  // marked as the placeholder it is rather than passed off as a forecast.
  return { cents: sumAssignmentPrices(input), basis: "allowance_fallback" };
}

/**
 * Combine several tools' expected spend into one period figure (P8).
 *
 * The basis of the total is the single basis if they all agree, and otherwise
 * the weakest one present — a total containing a placeholder is a placeholder,
 * and saying so is the whole point of carrying the basis around.
 */
export function combineExpectedSpend(
  parts: readonly ExpectedSpend[],
): ExpectedSpend {
  const cents = parts.reduce((sum, p) => sum + p.cents, 0);
  if (parts.length === 0) return { cents: 0, basis: "tier_price" };

  const bases = new Set(parts.map((p) => p.basis));
  if (bases.size === 1) return { cents, basis: [...bases][0] };

  // Weakest first: a fallback anywhere makes the total a placeholder.
  const order: ExpectedSpendBasis[] = [
    "allowance_fallback",
    "projected",
    "measured",
    "tier_price",
  ];
  const basis = order.find((b) => bases.has(b)) ?? "tier_price";
  return { cents, basis };
}

/** Human wording for a basis — used wherever a figure is displayed (P7/L5). */
export function basisLabel(basis: ExpectedSpendBasis): string {
  switch (basis) {
    case "tier_price":
      return "tier price";
    case "measured":
      return "measured consumption";
    case "projected":
      return `projected from the last ${PROJECTION_MONTHS} complete months`;
    case "allowance_fallback":
      return "allowance (no consumption history yet)";
  }
}
