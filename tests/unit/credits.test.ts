import { describe, it, expect } from "vitest";

import {
  creditBalanceProvenance,
  deriveCreditBalance,
  type DeriveCreditBalanceInput,
} from "@/lib/credits";

function input(over: Partial<DeriveCreditBalanceInput> = {}): DeriveCreditBalanceInput {
  return {
    toolId: 2,
    openingCents: 42272, // $422.72, recorded 2026-09-18
    openingAt: "2026-09-18",
    purchases: [],
    consumptionByDay: new Map(),
    ...over,
  };
}

describe("deriveCreditBalance", () => {
  it("is opening + purchases − consumption (C4/J4)", () => {
    const balance = deriveCreditBalance(
      input({
        purchases: [
          { purchasedAt: "2026-09-25", amountCents: 100_000 },
          { purchasedAt: "2026-10-05", amountCents: 50_000 },
        ],
        consumptionByDay: new Map([
          ["2026-09-20", 1_000],
          ["2026-10-01", 2_500],
        ]),
      }),
    );

    expect(balance.available).toBe(true);
    expect(balance.openingCents).toBe(42272);
    expect(balance.purchasedCents).toBe(150_000);
    expect(balance.consumedCents).toBe(3_500);
    expect(balance.balanceCents).toBe(42272 + 150_000 - 3_500);
    expect(balance.asOf).toBe("2026-09-18");
  });

  it("ignores events on or before the opening date", () => {
    // The opening balance already accounts for them; counting them again would
    // charge the same consumption twice.
    const balance = deriveCreditBalance(
      input({
        purchases: [
          { purchasedAt: "2026-09-17", amountCents: 999_999 },
          { purchasedAt: "2026-09-18", amountCents: 999_999 },
        ],
        consumptionByDay: new Map([
          ["2026-09-01", 50_000],
          ["2026-09-18", 50_000],
        ]),
      }),
    );

    expect(balance.purchasedCents).toBe(0);
    expect(balance.consumedCents).toBe(0);
    expect(balance.balanceCents).toBe(42272);
  });

  it("counts events strictly after the opening date", () => {
    const balance = deriveCreditBalance(
      input({
        purchases: [{ purchasedAt: "2026-09-19", amountCents: 10_000 }],
        consumptionByDay: new Map([["2026-09-19", 700]]),
      }),
    );

    expect(balance.purchasedCents).toBe(10_000);
    expect(balance.consumedCents).toBe(700);
  });

  it("reports unavailable when no opening balance is recorded (C5/FR-016)", () => {
    const balance = deriveCreditBalance(
      input({
        openingCents: null,
        openingAt: null,
        purchases: [{ purchasedAt: "2026-09-25", amountCents: 100_000 }],
        consumptionByDay: new Map([["2026-09-26", 1_000]]),
      }),
    );

    expect(balance.available).toBe(false);
    expect(balance.asOf).toBeNull();
    // Crucially NOT 99_000 — an unrecorded opening is not an opening of zero.
    expect(balance.balanceCents).toBe(0);
    expect(creditBalanceProvenance(balance)).toContain(
      "No opening balance recorded",
    );
  });

  it("treats a recorded opening of zero as a real number", () => {
    const balance = deriveCreditBalance(
      input({
        openingCents: 0,
        purchases: [{ purchasedAt: "2026-09-20", amountCents: 5_000 }],
      }),
    );

    expect(balance.available).toBe(true);
    expect(balance.balanceCents).toBe(5_000);
  });

  it("surfaces a negative balance rather than clamping it (C7)", () => {
    // Negative means a top-up was never recorded, or the opening is stale.
    // That is the signal; hiding it makes the figure useless.
    const balance = deriveCreditBalance(
      input({ consumptionByDay: new Map([["2026-09-30", 100_000]]) }),
    );

    expect(balance.balanceCents).toBe(42272 - 100_000);
    expect(balance.balanceCents).toBeLessThan(0);
  });

  it("always states that the figure is derived, with its as-of date (C6)", () => {
    const provenance = creditBalanceProvenance(deriveCreditBalance(input()));

    expect(provenance).toContain("2026-09-18");
    expect(provenance).toContain("Derived by the Hub");
    expect(provenance).toContain("Not read from Anthropic");
  });

  it("does not depend on the order of purchases", () => {
    const purchases = [
      { purchasedAt: "2026-10-05", amountCents: 50_000 },
      { purchasedAt: "2026-09-25", amountCents: 100_000 },
    ];

    expect(deriveCreditBalance(input({ purchases })).balanceCents).toBe(
      deriveCreditBalance(input({ purchases: [...purchases].reverse() }))
        .balanceCents,
    );
  });
});
