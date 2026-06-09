/**
 * Pure calculation engine for the API → Subscription migration scenario.
 *
 * No imports from `react`, `next`, or `@/lib/db` — only plain math and the
 * data types. This module runs identically on the server (initial render) and
 * in the browser (every control change), which guarantees the figures shown to
 * the user cannot drift from the ones covered by the unit tests.
 */

import type { ApiSubscriptionDataset, ApiUser } from "./types";

/** Which slice of history a user's "current spend" is read from. */
export type UsageBasis =
  | "avgComplete" // mean across all complete months (default)
  | "latestComplete" // the most recent complete month
  | "peakComplete" // the single highest complete month
  | { month: string }; // a specific 'YYYY-MM'

export type Population = "all" | "active";

export type ScenarioInputs = {
  standardCents: number;
  premiumCents: number;
  /** usage >= threshold ⇒ Premium seat, otherwise Standard. */
  premiumThresholdCents: number;
  basis: UsageBasis;
  population: Population;
};

export type SeatTier = "standard" | "premium";

export type ScenarioRow = {
  user: ApiUser;
  usageCents: number;
  tier: SeatTier;
  seatCents: number;
  /** seatCents − usageCents. Negative ⇒ the flat seat is cheaper than the user's API burn (a saving). */
  deltaCents: number;
};

export type ScenarioResult = {
  rows: ScenarioRow[];
  count: number;
  baselineCents: number; // metered API spend (sum of usage)
  allStandardCents: number; // everyone on a Standard seat
  allPremiumCents: number; // everyone on a Premium seat
  rightSizedCents: number; // threshold-based mix
  premiumCount: number;
  standardCount: number;
};

/** The user's representative monthly spend (cents) under the chosen basis. */
export function usageForUser(
  user: ApiUser,
  dataset: ApiSubscriptionDataset,
  basis: UsageBasis,
): number {
  const monthly = user.monthly;

  if (typeof basis === "object") {
    return monthly[basis.month] ?? 0;
  }

  const months = dataset.completeMonths;
  if (months.length === 0) return 0;

  if (basis === "latestComplete") {
    return monthly[months[months.length - 1]] ?? 0;
  }

  const values = months.map((m) => monthly[m] ?? 0);

  if (basis === "peakComplete") {
    return values.reduce((max, v) => (v > max ? v : max), 0);
  }

  // avgComplete
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round(sum / months.length);
}

/** Map a monthly spend onto the seat tier it qualifies for. */
export function mapSeat(
  usageCents: number,
  inputs: ScenarioInputs,
): { tier: SeatTier; seatCents: number } {
  const tier: SeatTier =
    usageCents >= inputs.premiumThresholdCents ? "premium" : "standard";
  return {
    tier,
    seatCents: tier === "premium" ? inputs.premiumCents : inputs.standardCents,
  };
}

/** Compute all four scenario totals plus the per-user mapping rows. */
export function computeScenarios(
  dataset: ApiSubscriptionDataset,
  inputs: ScenarioInputs,
): ScenarioResult {
  const pool =
    inputs.population === "active"
      ? dataset.users.filter((u) => u.status === "active")
      : dataset.users;

  let baselineCents = 0;
  let rightSizedCents = 0;
  let premiumCount = 0;

  const rows: ScenarioRow[] = pool.map((user) => {
    const usageCents = usageForUser(user, dataset, inputs.basis);
    const { tier, seatCents } = mapSeat(usageCents, inputs);
    baselineCents += usageCents;
    rightSizedCents += seatCents;
    if (tier === "premium") premiumCount += 1;
    return {
      user,
      usageCents,
      tier,
      seatCents,
      deltaCents: seatCents - usageCents,
    };
  });

  const count = pool.length;
  return {
    rows,
    count,
    baselineCents,
    allStandardCents: count * inputs.standardCents,
    allPremiumCents: count * inputs.premiumCents,
    rightSizedCents,
    premiumCount,
    standardCount: count - premiumCount,
  };
}

/**
 * Split a sorted-ascending list of `'YYYY-MM'` months into complete vs partial.
 * The current month is always partial; the earliest month is partial when data
 * collection began mid-month (`minDate` not the 1st) — mirroring Anthropic's
 * complete-UTC-day reporting. Pure so it can be unit-tested and reused by other
 * scenario calculators.
 */
export function classifyMonths(
  months: string[],
  minDate: string | null,
  currentMonth: string,
): { completeMonths: string[]; partialMonths: string[] } {
  const earliestMonth = months[0];
  const earliestIsDayOne = !!minDate && minDate.slice(-2) === "01";
  const completeMonths: string[] = [];
  const partialMonths: string[] = [];
  for (const mo of months) {
    if (mo === currentMonth || (mo === earliestMonth && !earliestIsDayOne)) {
      partialMonths.push(mo);
    } else {
      completeMonths.push(mo);
    }
  }
  return { completeMonths, partialMonths };
}
