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

// ---------------------------------------------------------------------------
// Phase 2 helpers
// ---------------------------------------------------------------------------

/**
 * Floor on the prior 3-month window before a user counts as a "mover".
 * Mirrors `TOP_MOVERS_FLOOR_CENTS` in `anthropic-global.ts` so the workspace
 * and user surfaces filter at the same threshold ($5).
 */
export const USER_TOP_MOVERS_FLOOR_CENTS = 500;

/** Maximum number of "fastest growing" chips rendered. */
export const USER_TOP_MOVERS_LIMIT = 3;

export interface UserMoverInput {
  userId: number;
  name: string;
  email: string;
  /** Sum of cents in the older half of the 6-month window. */
  priorCents: number;
  /** Sum of cents in the newer half of the 6-month window. */
  recentCents: number;
}

export interface RankedUserMover {
  userId: number;
  name: string;
  email: string;
  priorCents: number;
  recentCents: number;
  deltaPct: number;
}

/**
 * Rank user-level top movers — same rules as the workspace version:
 *  - filter `priorCents >= $5` (suppress noise from one-off micro spenders)
 *  - exclude non-positive deltas
 *  - sort by deltaPct DESC, tie-broken by email ASC for determinism
 *  - take the top N (default 3)
 */
export function rankUserTopMovers(
  rows: UserMoverInput[],
  limit: number = USER_TOP_MOVERS_LIMIT
): RankedUserMover[] {
  const ranked: RankedUserMover[] = [];
  for (const r of rows) {
    if (r.priorCents < USER_TOP_MOVERS_FLOOR_CENTS) continue;
    const delta = r.recentCents - r.priorCents;
    if (delta <= 0) continue;
    ranked.push({
      userId: r.userId,
      name: r.name,
      email: r.email,
      priorCents: r.priorCents,
      recentCents: r.recentCents,
      deltaPct: Math.round((delta / r.priorCents) * 100),
    });
  }
  ranked.sort((a, b) => {
    if (b.deltaPct !== a.deltaPct) return b.deltaPct - a.deltaPct;
    return a.email.localeCompare(b.email);
  });
  return ranked.slice(0, limit);
}
