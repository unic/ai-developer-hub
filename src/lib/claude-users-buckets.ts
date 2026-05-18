/**
 * Single source of truth for the Users cost-distribution histogram buckets.
 *
 * Keeping the boundaries here means the SQL that classifies user totals and
 * the React component that paints the x-axis labels agree by construction —
 * no risk of one drifting when the other is edited.
 *
 * Conventions:
 *  - All boundaries are integer **cents**, matching `computed_cost_cents`.
 *  - `minCents` is inclusive, `maxCents` is exclusive. The final "$100+"
 *    bucket has `maxCents = null` (unbounded).
 *  - The "$0" bucket uses `minCents: 0` and `maxCents: 1`, so the same
 *    inclusive-lower / exclusive-upper rule that applies to every other
 *    bucket represents "exactly zero" cleanly. Users who used Claude for a
 *    single cached read still fall into "$0.01–$1".
 */

export interface CostDistributionBucketDef {
  /** Stable machine key — used as the histogram `dataKey`. */
  key: "zero" | "lt1" | "lt10" | "lt50" | "lt100" | "gte100";
  /** Human label rendered on the x-axis. */
  label: string;
  /** Inclusive lower bound in cents. */
  minCents: number;
  /** Exclusive upper bound in cents (null = unbounded). */
  maxCents: number | null;
}

export const COST_DISTRIBUTION_BUCKETS: readonly CostDistributionBucketDef[] = [
  { key: "zero", label: "$0", minCents: 0, maxCents: 1 },
  { key: "lt1", label: "$0.01–$1", minCents: 1, maxCents: 100 },
  { key: "lt10", label: "$1–$10", minCents: 100, maxCents: 1_000 },
  { key: "lt50", label: "$10–$50", minCents: 1_000, maxCents: 5_000 },
  { key: "lt100", label: "$50–$100", minCents: 5_000, maxCents: 10_000 },
  { key: "gte100", label: "$100+", minCents: 10_000, maxCents: null },
] as const;

/**
 * Classify a user-period total (in cents) into one of the bucket keys above.
 *
 * Mirrors the SQL `CASE` so both paths agree. Extracted as a pure helper so
 * unit tests can verify the edge cases (`$0.99 / $1.00 / $1.01`, etc.) without
 * spinning up the database.
 */
export function bucketCents(cents: number): CostDistributionBucketDef["key"] {
  if (cents <= 0) return "zero";
  if (cents < 100) return "lt1";
  if (cents < 1_000) return "lt10";
  if (cents < 5_000) return "lt50";
  if (cents < 10_000) return "lt100";
  return "gte100";
}
