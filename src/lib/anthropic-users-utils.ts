import type { UserStatus } from "@/types";

/**
 * Pure helper functions used by `src/actions/anthropic-users.ts`.
 *
 * Extracted here (instead of co-located with the action) so the unit tests can
 * import them without dragging in `"use server"`, the DB client, or NextAuth.
 */

/**
 * Concentration of the top N spenders as a percentage of total org spend.
 *
 * Returns null when totalCents is 0 (no spend → ratio is undefined).
 * Otherwise returns an integer 0–100. Handles N greater than the row count
 * by simply summing whatever is there.
 */
export function topNConcentrationPct(
  costsDescending: number[],
  totalCents: number,
  n: number
): number | null {
  if (totalCents <= 0) return null;
  const take = Math.min(n, costsDescending.length);
  let sum = 0;
  for (let i = 0; i < take; i++) sum += costsDescending[i];
  return Math.round((sum / totalCents) * 100);
}

/**
 * MoM percent delta between current and prior period active user counts.
 *
 * Returns null when prior is zero (division undefined / first month).
 */
export function activeUserDeltaPct(
  currentCount: number,
  priorCount: number
): number | null {
  if (priorCount <= 0) return null;
  return Math.round(((currentCount - priorCount) / priorCount) * 100);
}

/** Counts active users with no resolved API key. */
export function countUsersWithNoApiKey(
  rows: { status: UserStatus; hasApiKey: boolean }[]
): { numerator: number; denominator: number } {
  let numerator = 0;
  let denominator = 0;
  for (const r of rows) {
    if (r.status !== "active") continue;
    denominator += 1;
    if (!r.hasApiKey) numerator += 1;
  }
  return { numerator, denominator };
}
