import { describe, it, expect } from "vitest";

import {
  combineExpectedSpend,
  expectedSpendForPeriod,
  PROJECTION_MONTHS,
  type ExpectedSpendInput,
} from "@/lib/expected-spend";
import { sumExpectedSpendCents, type AssignmentCostWindow } from "@/lib/budget-utils";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

function assignment(
  costAtAssignmentCents: number,
  assignedAt: string,
  revokedAt: string | null = null,
): AssignmentCostWindow {
  return {
    costAtAssignmentCents,
    assignedAt: d(assignedAt),
    revokedAt: revokedAt ? d(revokedAt) : null,
  };
}

const SEPTEMBER = {
  start: d("2026-09-01"),
  end: d("2026-09-30"),
  isComplete: false,
  months: ["2026-09"],
};

const AUGUST = {
  start: d("2026-08-01"),
  end: d("2026-08-31"),
  isComplete: true,
  months: ["2026-08"],
};

function input(over: Partial<ExpectedSpendInput> = {}): ExpectedSpendInput {
  return {
    pricingModel: "seat",
    assignments: [],
    measuredByMonth: new Map(),
    period: SEPTEMBER,
    ...over,
  };
}

describe("seat tiers are untouched (P1/J1)", () => {
  const assignments = [
    assignment(2500, "2026-01-01"),
    assignment(12500, "2026-05-15"),
    assignment(1900, "2026-08-01", "2026-09-10"),
    assignment(3900, "2026-10-01"), // starts after the period
  ];

  it("equals the tier-price sum, exactly as before this feature", () => {
    const result = expectedSpendForPeriod(
      input({ pricingModel: "seat", assignments }),
    );

    expect(result.basis).toBe("tier_price");
    expect(result.cents).toBe(
      sumExpectedSpendCents(assignments, SEPTEMBER.start, SEPTEMBER.end),
    );
    expect(result.cents).toBe(2500 + 12500 + 1900);
  });

  it("ignores consumption data entirely", () => {
    const withHistory = expectedSpendForPeriod(
      input({
        pricingModel: "seat",
        assignments,
        measuredByMonth: new Map([
          ["2026-06", 1],
          ["2026-07", 2],
          ["2026-08", 3],
        ]),
      }),
    );

    expect(withHistory.cents).toBe(2500 + 12500 + 1900);
    expect(withHistory.basis).toBe("tier_price");
  });
});

describe("usage tiers — completed periods use what was measured (J2)", () => {
  it("returns measured consumption, not the sum of allowances", () => {
    const result = expectedSpendForPeriod(
      input({
        pricingModel: "usage",
        // $3,650/month of allowances, as the Claude Console register carried.
        assignments: [assignment(12500, "2026-01-01"), assignment(352500, "2026-01-01")],
        measuredByMonth: new Map([["2026-08", 39869]]), // $398.69 actually spent
        period: AUGUST,
      }),
    );

    expect(result).toEqual({ cents: 39869, basis: "measured" });
  });

  it("sums every month a multi-month period spans", () => {
    const result = expectedSpendForPeriod(
      input({
        pricingModel: "usage",
        measuredByMonth: new Map([
          ["2026-07", 19489],
          ["2026-08", 39869],
          ["2026-09", 1],
        ]),
        period: {
          start: d("2026-07-01"),
          end: d("2026-08-31"),
          isComplete: true,
          months: ["2026-07", "2026-08"],
        },
      }),
    );

    expect(result).toEqual({ cents: 19489 + 39869, basis: "measured" });
  });
});

describe("usage tiers — open periods are projected", () => {
  it("averages the last three complete months", () => {
    const result = expectedSpendForPeriod(
      input({
        pricingModel: "usage",
        measuredByMonth: new Map([
          ["2026-06", 301686],
          ["2026-07", 19489],
          ["2026-08", 39869],
        ]),
      }),
    );

    expect(result.basis).toBe("projected");
    expect(result.cents).toBe(Math.round((301686 + 19489 + 39869) / 3));
  });

  it("uses only the most recent three when more history exists", () => {
    const result = expectedSpendForPeriod(
      input({
        pricingModel: "usage",
        measuredByMonth: new Map([
          ["2026-01", 1_000_000],
          ["2026-02", 1_000_000],
          ["2026-03", 1_000_000],
          ["2026-06", 300],
          ["2026-07", 300],
          ["2026-08", 300],
        ]),
      }),
    );

    expect(PROJECTION_MONTHS).toBe(3);
    expect(result.cents).toBe(300);
  });

  it("never projects from the period's own partial month (P6)", () => {
    // September is in progress with only $1 recorded so far. Projecting from
    // it would forecast ~$1 for the month.
    const result = expectedSpendForPeriod(
      input({
        pricingModel: "usage",
        measuredByMonth: new Map([
          ["2026-07", 20000],
          ["2026-08", 40000],
          ["2026-09", 100],
        ]),
      }),
    );

    expect(result.cents).toBe(30000);
    expect(result.basis).toBe("projected");
  });

  it("skips months with no data rather than counting them as zero", () => {
    const result = expectedSpendForPeriod(
      input({
        pricingModel: "usage",
        measuredByMonth: new Map([["2026-08", 40000]]),
      }),
    );

    // One month of history => that month, not 40000/3.
    expect(result.cents).toBe(40000);
  });

  it("projects each month of a multi-month open period", () => {
    const result = expectedSpendForPeriod(
      input({
        pricingModel: "usage",
        measuredByMonth: new Map([
          ["2026-07", 20000],
          ["2026-08", 40000],
        ]),
        period: {
          start: d("2026-10-01"),
          end: d("2026-12-31"),
          isComplete: false,
          months: ["2026-10", "2026-11", "2026-12"],
        },
      }),
    );

    expect(result.cents).toBe(30000 * 3);
    expect(result.basis).toBe("projected");
  });
});

describe("usage tiers — no history at all", () => {
  it("falls back to the allowance and says so", () => {
    const result = expectedSpendForPeriod(
      input({
        pricingModel: "usage",
        assignments: [assignment(12500, "2026-09-01")],
        measuredByMonth: new Map(),
      }),
    );

    expect(result).toEqual({ cents: 12500, basis: "allowance_fallback" });
  });

  it("falls back for a completed period with no data either", () => {
    const result = expectedSpendForPeriod(
      input({
        pricingModel: "usage",
        assignments: [assignment(12500, "2026-01-01")],
        measuredByMonth: new Map(),
        period: AUGUST,
      }),
    );

    expect(result.basis).toBe("allowance_fallback");
  });
});

describe("combineExpectedSpend (P8)", () => {
  it("sums a mixed portfolio", () => {
    const total = combineExpectedSpend([
      { cents: 1_477_500, basis: "tier_price" },
      { cents: 39869, basis: "measured" },
    ]);

    expect(total.cents).toBe(1_477_500 + 39869);
  });

  it("keeps a single shared basis", () => {
    expect(
      combineExpectedSpend([
        { cents: 100, basis: "tier_price" },
        { cents: 200, basis: "tier_price" },
      ]),
    ).toEqual({ cents: 300, basis: "tier_price" });
  });

  it("reports the weakest basis, so a placeholder is never hidden in a total", () => {
    expect(
      combineExpectedSpend([
        { cents: 1000, basis: "tier_price" },
        { cents: 500, basis: "projected" },
        { cents: 100, basis: "allowance_fallback" },
      ]).basis,
    ).toBe("allowance_fallback");

    expect(
      combineExpectedSpend([
        { cents: 1000, basis: "tier_price" },
        { cents: 500, basis: "measured" },
      ]).basis,
    ).toBe("measured");
  });

  it("handles an empty portfolio", () => {
    expect(combineExpectedSpend([])).toEqual({ cents: 0, basis: "tier_price" });
  });
});
