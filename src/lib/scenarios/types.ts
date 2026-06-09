/**
 * Shared data shapes for the Scenarios section (spec 035).
 *
 * These types are intentionally framework-free (no React, no Drizzle) so the
 * pure calculation engine in `api-subscription.ts` can be imported on both the
 * server (first paint) and the client (live re-compute) without dragging in
 * server-only modules.
 */

/** One API-key user (a Claude Console license assignment) + their monthly spend. */
export type ApiUser = {
  userId: number;
  name: string;
  email: string;
  discipline: string | null;
  status: "active" | "inactive";
  /** Anthropic workspace label carried on the assignment, if any. */
  workspace: string | null;
  /** Internal boost-tier the user is allocated to (context only). */
  internalTier: string | null;
  /** Map of `'YYYY-MM'` -> spend in cents (computed_cost_cents). */
  monthly: Record<string, number>;
};

/** Everything the calculator needs, assembled server-side from live data. */
export type ApiSubscriptionDataset = {
  users: ApiUser[];
  /** Complete calendar months with data, sorted ascending. */
  completeMonths: string[];
  /** Partial months — current month + a mid-join first month — sorted ascending. */
  partialMonths: string[];
  /** Default Standard seat price (cents), read live from access_tiers. */
  defaultStandardCents: number;
  /** Default Premium seat price (cents), read live from access_tiers. */
  defaultPremiumCents: number;
  /** ISO timestamp of when the dataset was assembled. */
  generatedAt: string;
};
