/**
 * Tier-change semantics for an active licence assignment (spec 042).
 *
 * Pure module — no db, no transaction, no "use server". It is the single place
 * these rules live, so the two real call sites (updateAssignment's tier branch
 * and approveRequest's change_tier mode) cannot drift apart, and so the rules
 * are unit-testable in CI.
 *
 * A tier change mutates the assignment row IN PLACE rather than closing it and
 * opening a new one. That is a deliberate, documented trade-off: the flat
 * monthly cost is attributed to every budget period the row's held-window
 * overlaps, with no proration, so two rows spanning the switch period would
 * both be counted and the person would be billed twice that month. See
 * specs/042-assignment-tier-change/implementation-plan.html §3 for the full
 * argument, including what in-place mutation costs (closed periods restate).
 */

/** Field diff shape consumed by recordUpdate in actions/history. */
export type ChangeMap = Record<string, { old: unknown; new: unknown }>;

export const SYNC_MANAGED_TIER_ERROR =
  "This seat's plan is managed by GitHub Copilot sync. Change the plan in GitHub — it will arrive on the next sync.";

export interface TierChangeResult {
  values: { tierId: number; costAtAssignmentCents: number };
  changes: ChangeMap;
}

export type BuildTierChangeOutcome =
  | TierChangeResult
  | { noop: true }
  | { error: string };

/**
 * Build the field updates + audit diff for a deliberate tier change.
 *
 * Callers own three things:
 *  - validating that the target tier exists, is active, and belongs to the same
 *    tool (each caller has a different tool context);
 *  - deciding what a no-op means — updateAssignment skips the write, while
 *    approveRequest must still approve and link the request;
 *  - persisting the returned change map to history.
 *
 * Order matters: the no-op check comes FIRST. The assignment detail form always
 * submits tierId, so refusing sync-managed rows before checking whether the tier
 * actually differs would reject every workspace/API-key edit on a synced seat.
 */
export function buildTierChange(
  current: {
    tierId: number;
    costAtAssignmentCents: number;
    isSyncManaged: boolean;
  },
  newTier: { id: number; monthlyCostCents: number },
): BuildTierChangeOutcome {
  if (newTier.id === current.tierId) return { noop: true };

  if (current.isSyncManaged) return { error: SYNC_MANAGED_TIER_ERROR };

  return {
    values: {
      tierId: newTier.id,
      costAtAssignmentCents: newTier.monthlyCostCents,
    },
    changes: {
      tierId: { old: current.tierId, new: newTier.id },
      costAtAssignmentCents: {
        old: current.costAtAssignmentCents,
        new: newTier.monthlyCostCents,
      },
    },
  };
}

export function isTierChangeNoop(
  outcome: BuildTierChangeOutcome,
): outcome is { noop: true } {
  return "noop" in outcome;
}

export function isTierChangeError(
  outcome: BuildTierChangeOutcome,
): outcome is { error: string } {
  return "error" in outcome;
}

/**
 * Signed monthly delta of a tier change, for UI copy only.
 *
 * Deliberately not an "upgrade/downgrade" verdict: access_tiers carries no rank
 * and price order is not an entitlement ladder — Claude Console's indie-profile
 * (€125) sits between boost-expert (€100) and boost-leader (€200) — so a
 * price-derived label would read wrongly for real tiers. Callers show the
 * number and let the admin judge.
 */
export function tierCostDeltaCents(
  fromCostCents: number,
  toCostCents: number,
): number {
  return toCostCents - fromCostCents;
}
