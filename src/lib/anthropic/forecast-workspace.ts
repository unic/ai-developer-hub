// Workspace-monthly spend forecast — pure function. Caller supplies the daily
// cost rows so the evaluator can batch-load history for all workspaces in one
// SQL query instead of N. See loadCostHistory() in queries.ts.
//
// Distinct from src/lib/forecast.ts (OLS over months for the annual budget
// tracker). This one projects month-end via a 7-day trailing rate from up to
// 30 days of daily history. Right tool for cap-based monthly alerts.

import {
  endOfMonth,
  format,
  getDate,
  getDaysInMonth,
  parseISO,
  subDays,
} from "date-fns";

export type WorkspaceForecast = {
  runRate7dCents: number;
  runRate30dCents: number;
  // (last 7d total − prior 7d total) / prior 7d total. Null when prior week
  // had < $1 of spend (denominator too small to be meaningful).
  runRateWoWPct: number | null;
  // currentMTD + runRate7dCents * daysRemainingInMonth.
  projectedMonthEndCents: number;
  // YYYY-MM-DD date the projection crosses the cap. Null if no cap, no
  // crossing, or already over (handled by the breach card instead).
  crossesCapOn: string | null;
  status: "on_track" | "at_risk" | "insufficient_data";
};

const MIN_HISTORY_DAYS = 3;

/**
 * @param dailyCosts  Map<YYYY-MM-DD, cents> for this workspace. Missing days
 *                    are treated as 0. Pre-loaded once via loadCostHistory().
 * @param month       Billing month as "YYYY-MM".
 * @param today       Current time. Pass explicitly for deterministic tests.
 * @param limitCents  Monthly cap in cents, or null when no cap.
 * @param todayEstimateCents  Spec 033 — the cost_report source has no row for
 *                    today, which dilutes the 7-day run-rate with a phantom 0
 *                    and drops today from MTD. When > 0 it fills today's slot
 *                    and is added to MTD. Defaults to 0 → identical to before.
 */
export function forecastWorkspaceMonth(
  dailyCosts: Map<string, number>,
  month: string,
  today: Date,
  limitCents: number | null,
  todayEstimateCents = 0,
): WorkspaceForecast {
  const monthStart = parseISO(`${month}-01`);
  const monthEndDate = endOfMonth(monthStart);
  const daysInMonth = getDaysInMonth(monthStart);
  const daysElapsed = Math.min(daysInMonth, Math.max(1, getDate(today)));
  const daysRemaining = Math.max(0, daysInMonth - daysElapsed);
  const todayStr = format(today, "yyyy-MM-dd");

  // Build dense daily series — fill missing days with 0 so averages are over
  // calendar days, not just billed days. Today has no cost_report row yet, so
  // fall back to the per-user estimate for that single slot.
  const last30: number[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = format(subDays(today, i), "yyyy-MM-dd");
    last30.push(dailyCosts.get(d) ?? (d === todayStr ? todayEstimateCents : 0));
  }
  const last7 = last30.slice(-7);
  const prev7 = last30.slice(-14, -7);

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const runRate7dCents = Math.round(sum(last7) / 7);
  const runRate30dCents = Math.round(sum(last30) / 30);

  const prev7Total = sum(prev7);
  const last7Total = sum(last7);
  const runRateWoWPct =
    prev7Total < 100
      ? null
      : Math.round(((last7Total - prev7Total) / prev7Total) * 100);

  const mtdStart = format(monthStart, "yyyy-MM-dd");
  const mtdEnd = format(today < monthEndDate ? today : monthEndDate, "yyyy-MM-dd");
  let mtdCents = 0;
  let distinctMtdDays = 0;
  for (const [date, cents] of dailyCosts) {
    if (date >= mtdStart && date <= mtdEnd) {
      mtdCents += cents;
      if (cents > 0) distinctMtdDays += 1;
    }
  }
  // Spec 033: cost_report lacks today — add the estimate when today is in MTD
  // and not already billed (it won't be, but guard against double-counting).
  if (
    todayEstimateCents > 0 &&
    todayStr >= mtdStart &&
    todayStr <= mtdEnd &&
    !dailyCosts.has(todayStr)
  ) {
    mtdCents += todayEstimateCents;
    distinctMtdDays += 1;
  }

  const projectedMonthEndCents = mtdCents + runRate7dCents * daysRemaining;

  if (distinctMtdDays < MIN_HISTORY_DAYS) {
    return {
      runRate7dCents,
      runRate30dCents,
      runRateWoWPct,
      projectedMonthEndCents,
      crossesCapOn: null,
      status: "insufficient_data",
    };
  }

  if (limitCents === null || limitCents <= 0) {
    return {
      runRate7dCents,
      runRate30dCents,
      runRateWoWPct,
      projectedMonthEndCents,
      crossesCapOn: null,
      status: "on_track",
    };
  }

  // Already over — the breach card handles the signal; no "crosses" date.
  if (mtdCents >= limitCents) {
    return {
      runRate7dCents,
      runRate30dCents,
      runRateWoWPct,
      projectedMonthEndCents,
      crossesCapOn: null,
      status: projectedMonthEndCents > limitCents ? "at_risk" : "on_track",
    };
  }

  const willOvershoot = projectedMonthEndCents > limitCents;
  let crossesCapOn: string | null = null;
  if (willOvershoot && runRate7dCents > 0) {
    const centsToReachCap = limitCents - mtdCents;
    const daysToReachCap = Math.ceil(centsToReachCap / runRate7dCents);
    const crossDate = new Date(today);
    crossDate.setDate(crossDate.getDate() + daysToReachCap);
    const clamped = crossDate > monthEndDate ? monthEndDate : crossDate;
    crossesCapOn = format(clamped, "yyyy-MM-dd");
  }

  return {
    runRate7dCents,
    runRate30dCents,
    runRateWoWPct,
    projectedMonthEndCents,
    crossesCapOn,
    status: willOvershoot ? "at_risk" : "on_track",
  };
}
