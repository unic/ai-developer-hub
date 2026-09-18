/**
 * Watching for the Hub's numbers drifting from Anthropic's.
 *
 * The original pricing defect ran for over a month undetected, even though the
 * data to catch it was already in the database: `pricing_resolved = false` was
 * set on every affected row and nothing ever read it. A flag nobody reads is
 * not a control. These checks produce sync EVENTS, which an admin sees.
 *
 * Making per-user cost billed removes the defect where a workspace has a sole
 * owner, but not everywhere — apportioned workspaces, the current-day estimate
 * and the price table all survive — so what remains needs a watchdog.
 *
 * Pure. Rules in specs/045-usage-based-cost-model/contracts/cost-attribution.md §5.
 */

/**
 * How far billed and computed may diverge before it is worth saying.
 *
 * Relative alone would shout about a workspace that spent 12 cents; absolute
 * alone would miss a 30% overstatement on a big one. The larger of the two is
 * the floor, so small workspaces stay quiet and large ones stay honest.
 */
export const TOLERANCE_FLOOR_CENTS = 500;
export const TOLERANCE_FRACTION = 0.05;

export interface DivergenceInput {
  workspaceId: string | null;
  workspaceName?: string | null;
  /** The period being checked, for the message: e.g. "2026-08". */
  period: string;
  billedCents: number;
  /** The Hub's own computed figure for the same days and owners. */
  attributedCents: number;
  /** True when the workspace has spend but no resolved owner. */
  hasOwner?: boolean;
}

export interface Divergence {
  workspaceId: string | null;
  period: string;
  billedCents: number;
  attributedCents: number;
  /** computed / billed. Null when billed is zero — a ratio would be undefined. */
  ratio: number | null;
  differenceCents: number;
  toleranceCents: number;
  reason: "over_tolerance" | "spend_without_owner";
  message: string;
}

function toleranceFor(billedCents: number): number {
  return Math.max(
    TOLERANCE_FLOOR_CENTS,
    Math.round(Math.abs(billedCents) * TOLERANCE_FRACTION),
  );
}

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Compare one workspace-period. Returns null when there is nothing to say.
 *
 * A workspace with spend and no owner is reported even though no comparison is
 * possible: it means someone's cost silently became nobody's, which is exactly
 * the failure that would otherwise show up as a user's spend quietly reading
 * zero (plan risk 3).
 */
export function detectDivergence(input: DivergenceInput): Divergence | null {
  const { workspaceId, workspaceName, period, billedCents, attributedCents } =
    input;
  const label = workspaceName ?? workspaceId ?? "the default workspace";

  if (input.hasOwner === false && billedCents > 0) {
    return {
      workspaceId,
      period,
      billedCents,
      attributedCents,
      ratio: null,
      differenceCents: billedCents,
      toleranceCents: 0,
      reason: "spend_without_owner",
      message:
        `${label} was billed ${usd(billedCents)} in ${period} but has no resolved owner, ` +
        `so none of it is attributed to a user. Check the API-key mapping, or record a manual owner.`,
    };
  }

  const tolerance = toleranceFor(billedCents);
  const difference = attributedCents - billedCents;

  if (Math.abs(difference) <= tolerance) return null;

  const ratio = billedCents === 0 ? null : attributedCents / billedCents;

  return {
    workspaceId,
    period,
    billedCents,
    attributedCents,
    ratio,
    differenceCents: difference,
    toleranceCents: tolerance,
    reason: "over_tolerance",
    message:
      `${label}: the Hub computed ${usd(attributedCents)} for ${period} against ` +
      `${usd(billedCents)} billed by Anthropic` +
      (ratio === null ? "" : ` (${ratio.toFixed(2)}x)`) +
      `, a difference of ${usd(difference)} beyond the ${usd(tolerance)} tolerance. ` +
      `Likely a model missing from the price table, a changed price, or a broken key mapping.`,
  };
}

/** The warning raised when the usage sync meets a model it cannot price. */
export function unknownModelMessage(models: readonly string[]): string {
  const shown = models.slice(0, 10);
  const more = models.length > shown.length ? ` and ${models.length - shown.length} more` : "";
  return (
    `The price table has no entry for ${models.length} model(s): ${shown.join(", ")}${more}. ` +
    `Their computed cost falls back to the highest known rate, which overstates it. ` +
    `Billed cost is unaffected for complete days; the current-day estimate is not.`
  );
}
