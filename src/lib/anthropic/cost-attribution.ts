/**
 * Turning billed workspace cost into per-user cost.
 *
 * Pure functions — no database, no network, no clock. The normative rules live
 * in specs/045-usage-based-cost-model/contracts/cost-attribution.md and are
 * referenced below as R1-R10.
 *
 * Money is integer cents throughout. Splits use largest-remainder so the parts
 * sum EXACTLY to the total: never a floating-point division into a rounded
 * result, which loses or invents cents.
 */

/** How a cost figure was produced. `estimated` exists only at the API
 *  boundary — no stored row carries it, because only complete days are stored. */
export type AttributionMethod = "billed" | "apportioned" | "estimated";

/** What a workspace's ownership implies for attribution (R1). */
export type AttributionMode = "billed" | "apportioned" | "unattributed";

export interface AttributedDailyCost {
  userId: number;
  costCents: number;
  method: Exclude<AttributionMethod, "estimated">;
}

/** A per-model usage row for one user-day — the grain attribution is stored at. */
export interface ModelWeight {
  model: string;
  computedCostCents: number;
}

export interface ModelShare {
  model: string;
  costCents: number;
}

/**
 * Derive a workspace's attribution mode from how many users own it.
 *
 * Derived rather than stored, so an admin correcting ownership changes the next
 * read with no re-sync (FR-023).
 */
export function deriveMode(ownerCount: number): AttributionMode {
  if (ownerCount === 1) return "billed";
  if (ownerCount > 1) return "apportioned";
  return "unattributed";
}

/**
 * Split `totalCents` across `weights` so the parts sum exactly to the total.
 *
 * Largest remainder: everyone gets their floor share, then the leftover cents
 * go one at a time to the largest fractional remainders. Ties break by
 * ascending key, so the same input always produces the same output (R2).
 *
 * All weights zero => an even split by the same rule (R3). That happens when a
 * workspace has billed cost but no matching usage rows — a cost type the usage
 * report does not cover — and the cost still has to land somewhere.
 */
function largestRemainder<K extends string | number>(
  totalCents: number,
  weights: { key: K; weight: number }[],
): Map<K, number> {
  const result = new Map<K, number>();
  if (weights.length === 0) return result;

  // Deterministic order first: every downstream tie-break depends on it.
  const ordered = [...weights].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );

  const totalWeight = ordered.reduce((sum, w) => sum + Math.max(0, w.weight), 0);
  const useEvenSplit = totalWeight <= 0;

  // Work in a scaled integer domain so no floating-point value decides a cent.
  // exact_i = totalCents * weight_i / totalWeight; floor it, then hand out the
  // remainder by the size of what was dropped.
  const shares = ordered.map(({ key, weight }) => {
    const w = useEvenSplit ? 1 : Math.max(0, weight);
    const denominator = useEvenSplit ? ordered.length : totalWeight;
    const scaled = totalCents * w;
    const floorShare = Math.floor(scaled / denominator);
    return {
      key,
      floorShare,
      remainder: scaled - floorShare * denominator,
    };
  });

  let distributed = shares.reduce((sum, s) => sum + s.floorShare, 0);
  let leftover = totalCents - distributed;

  // A negative total (a credit / correction) floors away from zero, so the
  // leftover is negative; hand it out the same way, smallest remainder first.
  const order = [...shares].sort((a, b) =>
    leftover >= 0 ? b.remainder - a.remainder : a.remainder - b.remainder,
  );
  const step = leftover >= 0 ? 1 : -1;
  for (const share of order) {
    if (leftover === 0) break;
    share.floorShare += step;
    leftover -= step;
  }

  distributed = 0;
  for (const share of shares) {
    result.set(share.key, share.floorShare);
    distributed += share.floorShare;
  }

  // The invariant this function exists for. If it ever fails, a cent was
  // created or lost and every figure downstream is suspect.
  if (distributed !== totalCents) {
    throw new Error(
      `largestRemainder did not preserve the total: ${distributed} !== ${totalCents}`,
    );
  }

  return result;
}

/**
 * Apportion a workspace's billed cost across its owners, weighted by each
 * owner's computed cost for the same day (R2/R3).
 *
 * Weighting by computed cost rather than raw tokens is deliberate: computed
 * cost already weights models and token types against each other, while raw
 * tokens over-weight cheap cache reads.
 */
export function apportion(
  billedCents: number,
  weights: { userId: number; computedCostCents: number }[],
): Map<number, number> {
  return largestRemainder(
    billedCents,
    weights.map((w) => ({ key: w.userId, weight: w.computedCostCents })),
  );
}

/**
 * Attribute one workspace-day to its owners.
 *
 * Returns nothing for an unattributed workspace: that cost belongs to no user
 * and stays in org totals only (R4, FR-007). Never fall back to "closest
 * owner" — an unowned workspace with spend is a reconciliation warning, not a
 * guess.
 */
export function attributeDay(input: {
  billedCents: number;
  owners: number[];
  computedByUser: Map<number, number>;
}): AttributedDailyCost[] {
  const { billedCents, owners, computedByUser } = input;
  const mode = deriveMode(owners.length);

  if (mode === "unattributed") return [];

  if (mode === "billed") {
    return [{ userId: owners[0], costCents: billedCents, method: "billed" }];
  }

  const shares = apportion(
    billedCents,
    owners.map((userId) => ({
      userId,
      computedCostCents: computedByUser.get(userId) ?? 0,
    })),
  );

  return owners
    .map((userId) => ({
      userId,
      costCents: shares.get(userId) ?? 0,
      method: "apportioned" as const,
    }))
    .sort((a, b) => a.userId - b.userId);
}

/**
 * Spread a user's daily figure across their per-model usage rows (R9).
 *
 * anthropic_usage_metrics is keyed on (user_id, date, model) and the read rule
 * sums those rows, so the daily figure has to be stored per model. A second
 * largest-remainder pass keeps the parts summing exactly to the day, which is
 * what makes SUM(COALESCE(attributed, computed)) reproduce it to the cent.
 *
 * One model row => the identity. All rows zero-weight => an even split.
 */
export function distributeAcrossModels(
  userDayCents: number,
  rows: ModelWeight[],
): ModelShare[] {
  if (rows.length === 0) return [];
  if (rows.length === 1) {
    return [{ model: rows[0].model, costCents: userDayCents }];
  }

  const shares = largestRemainder(
    userDayCents,
    rows.map((r) => ({ key: r.model, weight: r.computedCostCents })),
  );

  return rows.map((r) => ({
    model: r.model,
    costCents: shares.get(r.model) ?? 0,
  }));
}

/**
 * The model string on the carrier row written when a workspace has billed cost
 * for a day but its owner has no usage row at all (R10).
 *
 * Without it the cost would be silently dropped — the read rule can only find
 * what a usage row carries. Excluded from model breakdowns, which come from
 * the cost line items.
 */
export const BILLED_ONLY_MODEL = "__billed_only__";
