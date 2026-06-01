// Spec 033 — current-day cost estimate.
//
// Pure, dependency-free helper. The Anthropic `cost_report` (workspace) source
// only ever returns COMPLETE UTC days, so the workspace/global views are always
// missing "today". The per-USER `usage_report` source, by contrast, holds a
// real hourly-fresh cost for today. The two sources DO NOT reconcile exactly
// (different endpoints, pricing-table drift, unmapped spend, rounding — see
// specs/027 data-model.md:107), so we must not treat "sum of per-user today" as
// the workspace cost. Instead we use it as a signal and CALIBRATE it against how
// the two sources actually relate over recent complete days.
//
// No I/O, no `server-only` — safe to import from client components (e.g. to read
// the TodayEstimate shape). The query/aggregation layer (queries.ts) decides
// when the estimate is null (no today data, or the usage sync is stale).

/** Complete days used to calibrate per-user → workspace cost. */
export const CALIBRATION_LOOKBACK_DAYS = 7;
/** Clamp band so a noisy week can't 2×/½× the figure. */
export const CALIBRATION_MIN = 0.5;
export const CALIBRATION_MAX = 2.0;

/**
 * The estimate carried on every DTO that exposes month-to-date cost.
 *
 * `null` (at the DTO level) ⇒ nothing to show — no per-user data for today, or
 * the usage sync is stale ⇒ the UI falls back to actual-only.
 */
export type TodayEstimate = {
  /** Calibrated estimate of today's spend SO FAR (cumulative to now), in cents. */
  cents: number;
  /** Uncalibrated per-user sum for today, in cents (shown in the tooltip). */
  rawUserCents: number;
  /** Ratio applied to rawUserCents (1.0 when not confident). */
  calibration: number;
  /** Had ≥1 recent complete day in BOTH sources to calibrate against. */
  confident: boolean;
  /** ISO timestamp of the per-user usage sync — drives the freshness label. */
  asOfIso: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Calibrate today's per-user spend against the recent per-user↔workspace ratio.
 *
 * The estimate is today's spend SO FAR (cumulative to the current hour), NOT a
 * full-day extrapolation — it is the most defensible "as up to date as possible"
 * number. The run-rate handles the remaining days of the month.
 */
export function estimateTodayCostCents(input: {
  /** SUM(usage_metrics.computed_cost_cents) WHERE date = today (real, hourly). */
  todayUserCostCents: number;
  /** SUM over the last N COMPLETE days, per-user source. */
  recentUserCostCents: number;
  /** SUM over the SAME N complete days, workspace source. */
  recentWorkspaceCostCents: number;
}): { estimatedTodayCents: number; calibration: number; confident: boolean } {
  // Calibration = how much bigger the billed workspace total runs vs our
  // per-user estimate over the recent complete days.
  const raw =
    input.recentUserCostCents > 0
      ? input.recentWorkspaceCostCents / input.recentUserCostCents
      : 1;
  // Clamp to a sane band; fall back to 1.0 when either source is thin.
  const calibration = clamp(raw, CALIBRATION_MIN, CALIBRATION_MAX);
  const confident =
    input.recentUserCostCents > 0 && input.recentWorkspaceCostCents > 0;
  return {
    estimatedTodayCents: Math.round(
      input.todayUserCostCents * (confident ? calibration : 1)
    ),
    calibration: confident ? calibration : 1,
    confident,
  };
}
