import { describe, it, expect } from "vitest";

import {
  buildTierChange,
  isTierChangeError,
  isTierChangeNoop,
  tierCostDeltaCents,
  SYNC_MANAGED_TIER_ERROR,
} from "@/lib/assignments/tier-change";
import {
  overlapsPeriod,
  sumExpectedSpendCents,
  type AssignmentCostWindow,
} from "@/lib/budget-utils";

/**
 * Spec 042. These are pure-logic tests on purpose: the integration suite is not
 * wired into CI (.github/workflows/ci.yml has the integration-tests job
 * commented out), so anything that must *block a merge* has to live here.
 */

// Live prices, verified against production via MCP list_ai_tools.
const CLAUDE_STANDARD = { id: 10, monthlyCostCents: 2500 };
const CLAUDE_PREMIUM = { id: 11, monthlyCostCents: 12_500 };

describe("buildTierChange", () => {
  const activeStandardSeat = {
    tierId: CLAUDE_STANDARD.id,
    costAtAssignmentCents: CLAUDE_STANDARD.monthlyCostCents,
    isSyncManaged: false,
  };

  it("moves tier and re-snapshots cost, with an audit diff for both fields", () => {
    const outcome = buildTierChange(activeStandardSeat, CLAUDE_PREMIUM);

    expect(isTierChangeNoop(outcome)).toBe(false);
    expect(isTierChangeError(outcome)).toBe(false);
    if (isTierChangeNoop(outcome) || isTierChangeError(outcome)) return;

    expect(outcome.values).toEqual({
      tierId: CLAUDE_PREMIUM.id,
      costAtAssignmentCents: 12_500,
    });
    expect(outcome.changes).toEqual({
      tierId: { old: CLAUDE_STANDARD.id, new: CLAUDE_PREMIUM.id },
      costAtAssignmentCents: { old: 2500, new: 12_500 },
    });
  });

  it("treats the same tier as a no-op, so nothing is written", () => {
    expect(isTierChangeNoop(buildTierChange(activeStandardSeat, CLAUDE_STANDARD))).toBe(
      true,
    );
  });

  it("refuses a sync-managed seat, because the next cron would revert it", () => {
    const outcome = buildTierChange(
      { ...activeStandardSeat, isSyncManaged: true },
      CLAUDE_PREMIUM,
    );
    expect(isTierChangeError(outcome)).toBe(true);
    if (!isTierChangeError(outcome)) return;
    expect(outcome.error).toBe(SYNC_MANAGED_TIER_ERROR);
  });

  /**
   * Order matters. The assignment detail form always submits tierId, so if the
   * sync-managed check ran before the no-op check, every workspace or API-key
   * edit on a synced seat would be rejected too.
   */
  it("reports a no-op BEFORE refusing a sync-managed seat", () => {
    const outcome = buildTierChange(
      { ...activeStandardSeat, isSyncManaged: true },
      CLAUDE_STANDARD,
    );
    expect(isTierChangeNoop(outcome)).toBe(true);
    expect(isTierChangeError(outcome)).toBe(false);
  });

  it("works in both directions — the helper has no notion of up or down", () => {
    const premiumSeat = {
      tierId: CLAUDE_PREMIUM.id,
      costAtAssignmentCents: CLAUDE_PREMIUM.monthlyCostCents,
      isSyncManaged: false,
    };
    const outcome = buildTierChange(premiumSeat, CLAUDE_STANDARD);
    if (isTierChangeNoop(outcome) || isTierChangeError(outcome)) {
      throw new Error("expected a change");
    }
    expect(outcome.values.costAtAssignmentCents).toBe(2500);
  });
});

describe("tierCostDeltaCents", () => {
  it("signs the delta both ways", () => {
    expect(tierCostDeltaCents(2500, 12_500)).toBe(10_000);
    expect(tierCostDeltaCents(12_500, 2500)).toBe(-10_000);
    expect(tierCostDeltaCents(2500, 2500)).toBe(0);
  });

  /**
   * Claude Console's real ladder is not monotonic in price: indie-profile (€125)
   * sits between boost-expert (€100) and boost-leader (€200). This is why the
   * feature shows a signed number and never derives an "upgrade"/"downgrade"
   * label from cost.
   */
  it("does not imply an entitlement ordering (Claude Console indie-profile)", () => {
    const boostExpert = 10_000;
    const indieProfile = 12_500;
    const boostLeader = 20_000;

    expect(tierCostDeltaCents(boostExpert, indieProfile)).toBeGreaterThan(0);
    expect(tierCostDeltaCents(indieProfile, boostLeader)).toBeGreaterThan(0);
    // ...yet indie-profile is not "between" expert and leader in entitlement
    // terms at all. Price order alone cannot tell you that, hence no label.
    expect(indieProfile).toBeGreaterThan(boostExpert);
    expect(indieProfile).toBeLessThan(boostLeader);
  });
});

/**
 * The reason a tier change mutates in place instead of closing one row and
 * opening another. Per-period expected spend attributes the FULL flat monthly
 * tier price to every period an assignment's held-window overlaps, with no
 * proration — so two rows spanning the switch period are both counted.
 *
 * This test pins that as a known property of the rejected design. If someone
 * later "simplifies" the tier change into a deactivate+insert (as assignLicense
 * does), the double-count assertion here is what should stop them.
 */
describe("per-period cost attribution — why the tier change is in-place", () => {
  const AUG_START = new Date("2026-08-01");
  const AUG_END = new Date("2026-08-31");
  const JUL_START = new Date("2026-07-01");
  const JUL_END = new Date("2026-07-31");
  const SEP_START = new Date("2026-09-01");
  const SEP_END = new Date("2026-09-30");

  const HELD_SINCE = new Date("2026-03-10");
  const SWITCHED_ON = new Date("2026-08-15");

  /** What this spec does: one row, tier and cost mutated. */
  const inPlace: AssignmentCostWindow[] = [
    {
      assignedAt: HELD_SINCE,
      revokedAt: null,
      costAtAssignmentCents: CLAUDE_PREMIUM.monthlyCostCents,
    },
  ];

  /** What assignLicense does: close the old row, open a new one. */
  const deactivateAndInsert: AssignmentCostWindow[] = [
    {
      assignedAt: HELD_SINCE,
      revokedAt: SWITCHED_ON,
      costAtAssignmentCents: CLAUDE_STANDARD.monthlyCostCents,
    },
    {
      assignedAt: SWITCHED_ON,
      revokedAt: null,
      costAtAssignmentCents: CLAUDE_PREMIUM.monthlyCostCents,
    },
  ];

  it("in-place bills the switch month once, at the new tier", () => {
    expect(sumExpectedSpendCents(inPlace, AUG_START, AUG_END)).toBe(12_500);
  });

  it("deactivate+insert DOUBLE-COUNTS the switch month — one seat, two prices", () => {
    expect(sumExpectedSpendCents(deactivateAndInsert, AUG_START, AUG_END)).toBe(
      2500 + 12_500,
    );
  });

  it("the double count is confined to the switch period", () => {
    // July: the new row has not started yet.
    expect(sumExpectedSpendCents(deactivateAndInsert, JUL_START, JUL_END)).toBe(2500);
    // September: the old row is long revoked.
    expect(sumExpectedSpendCents(deactivateAndInsert, SEP_START, SEP_END)).toBe(12_500);
  });

  /**
   * The cost of the chosen design, asserted rather than merely documented:
   * closed periods restate at the new price. deactivate+insert would have kept
   * July at €25. This is the accepted trade-off (see plan §3) and the reason the
   * UI discloses it at the point of change.
   */
  it("in-place restates already-closed periods at the new price", () => {
    expect(sumExpectedSpendCents(inPlace, JUL_START, JUL_END)).toBe(12_500);
    expect(sumExpectedSpendCents(deactivateAndInsert, JUL_START, JUL_END)).toBe(2500);
  });

  describe("overlapsPeriod boundaries", () => {
    it("counts an assignment that starts on the last day of a period", () => {
      expect(
        overlapsPeriod(
          { assignedAt: AUG_END, revokedAt: null, costAtAssignmentCents: 1 },
          AUG_START,
          AUG_END,
        ),
      ).toBe(true);
    });

    it("counts an assignment revoked exactly on periodStart (the >= bound)", () => {
      expect(
        overlapsPeriod(
          { assignedAt: HELD_SINCE, revokedAt: AUG_START, costAtAssignmentCents: 1 },
          AUG_START,
          AUG_END,
        ),
      ).toBe(true);
    });

    it("excludes an assignment revoked before the period opens", () => {
      expect(
        overlapsPeriod(
          { assignedAt: HELD_SINCE, revokedAt: JUL_END, costAtAssignmentCents: 1 },
          AUG_START,
          AUG_END,
        ),
      ).toBe(false);
    });

    it("excludes an assignment that starts after the period closes", () => {
      expect(
        overlapsPeriod(
          { assignedAt: SEP_START, revokedAt: null, costAtAssignmentCents: 1 },
          AUG_START,
          AUG_END,
        ),
      ).toBe(false);
    });
  });
});
