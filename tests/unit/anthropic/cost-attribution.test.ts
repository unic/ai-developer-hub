import { describe, it, expect } from "vitest";

import {
  apportion,
  attributeDay,
  deriveMode,
  distributeAcrossModels,
  BILLED_ONLY_MODEL,
} from "@/lib/anthropic/cost-attribution";

const sum = (values: Iterable<number>) => {
  let total = 0;
  for (const v of values) total += v;
  return total;
};

describe("deriveMode", () => {
  it("maps owner count onto the three modes", () => {
    expect(deriveMode(0)).toBe("unattributed");
    expect(deriveMode(1)).toBe("billed");
    expect(deriveMode(2)).toBe("apportioned");
    expect(deriveMode(7)).toBe("apportioned");
  });
});

describe("apportion", () => {
  it("splits proportionally when the split is exact", () => {
    const shares = apportion(1000, [
      { userId: 1, computedCostCents: 750 },
      { userId: 2, computedCostCents: 250 },
    ]);

    expect(shares.get(1)).toBe(750);
    expect(shares.get(2)).toBe(250);
  });

  it("sums exactly to the billed total across 2, 3 and 5 owners", () => {
    for (const ownerCount of [2, 3, 5]) {
      const weights = Array.from({ length: ownerCount }, (_, i) => ({
        userId: i + 1,
        computedCostCents: 100 + i * 37,
      }));
      // 1 cent through to an awkward prime-ish total.
      for (const total of [1, 2, 3, 7, 99, 100, 1_000, 10_007, 999_983]) {
        const shares = apportion(total, weights);
        expect(sum(shares.values())).toBe(total);
        expect(shares.size).toBe(ownerCount);
      }
    }
  });

  it("gives the single leftover cent to the largest remainder", () => {
    // Three equal owners, 1 cent: floors are 0,0,0 and remainders tie, so the
    // lowest userId takes it (deterministic tie-break).
    const shares = apportion(1, [
      { userId: 3, computedCostCents: 10 },
      { userId: 1, computedCostCents: 10 },
      { userId: 2, computedCostCents: 10 },
    ]);

    expect(sum(shares.values())).toBe(1);
    expect(shares.get(1)).toBe(1);
    expect(shares.get(2)).toBe(0);
    expect(shares.get(3)).toBe(0);
  });

  it("is deterministic regardless of input order", () => {
    const weights = [
      { userId: 4, computedCostCents: 33 },
      { userId: 9, computedCostCents: 33 },
      { userId: 2, computedCostCents: 34 },
    ];
    const forwards = apportion(101, weights);
    const backwards = apportion(101, [...weights].reverse());

    expect([...forwards.entries()].sort()).toEqual(
      [...backwards.entries()].sort(),
    );
  });

  it("splits evenly when every weight is zero", () => {
    // Billed cost with no matching usage rows — the cost still has to land.
    const shares = apportion(10, [
      { userId: 1, computedCostCents: 0 },
      { userId: 2, computedCostCents: 0 },
      { userId: 3, computedCostCents: 0 },
      { userId: 4, computedCostCents: 0 },
    ]);

    expect(sum(shares.values())).toBe(10);
    expect([...shares.values()].sort((a, b) => a - b)).toEqual([2, 2, 3, 3]);
  });

  it("gives a zero-weight owner nothing when others have weight", () => {
    const shares = apportion(100, [
      { userId: 1, computedCostCents: 0 },
      { userId: 2, computedCostCents: 50 },
      { userId: 3, computedCostCents: 50 },
    ]);

    expect(shares.get(1)).toBe(0);
    expect(shares.get(2)).toBe(50);
    expect(shares.get(3)).toBe(50);
  });

  it("handles a zero total", () => {
    const shares = apportion(0, [
      { userId: 1, computedCostCents: 10 },
      { userId: 2, computedCostCents: 20 },
    ]);

    expect(sum(shares.values())).toBe(0);
  });

  it("preserves the total over many random splits", () => {
    // Property-style: the invariant that matters is that no cent is created
    // or lost, whatever the shape of the input.
    let seed = 20260918;
    const rand = (n: number) => {
      // Deterministic LCG — a failing case must be reproducible.
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed % n;
    };

    for (let trial = 0; trial < 500; trial++) {
      const ownerCount = 1 + rand(6);
      const weights = Array.from({ length: ownerCount }, (_, i) => ({
        userId: i + 1,
        computedCostCents: rand(5000),
      }));
      const total = rand(200_000);

      const shares = apportion(total, weights);
      expect(sum(shares.values())).toBe(total);
      // No owner may be handed more than the workspace was billed (I2).
      for (const share of shares.values()) {
        expect(share).toBeLessThanOrEqual(total);
        expect(share).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("attributeDay", () => {
  it("gives the whole billed cost to a sole owner, unmodified", () => {
    const rows = attributeDay({
      billedCents: 3283,
      owners: [42],
      computedByUser: new Map([[42, 24932]]), // wildly wrong estimate: ignored
    });

    expect(rows).toEqual([{ userId: 42, costCents: 3283, method: "billed" }]);
  });

  it("apportions across several owners and still sums to the billed total", () => {
    const rows = attributeDay({
      billedCents: 1001,
      owners: [7, 8, 9],
      computedByUser: new Map([
        [7, 500],
        [8, 300],
        [9, 200],
      ]),
    });

    expect(rows.every((r) => r.method === "apportioned")).toBe(true);
    expect(sum(rows.map((r) => r.costCents))).toBe(1001);
  });

  it("attributes nothing when the workspace has no owner", () => {
    const rows = attributeDay({
      billedCents: 12662,
      owners: [],
      computedByUser: new Map(),
    });

    // The spend stays in org totals, labelled unattributed — never guessed
    // onto a user.
    expect(rows).toEqual([]);
  });
});

describe("distributeAcrossModels", () => {
  it("is the identity for a single model row", () => {
    expect(
      distributeAcrossModels(3283, [
        { model: "claude-opus-4", computedCostCents: 99 },
      ]),
    ).toEqual([{ model: "claude-opus-4", costCents: 3283 }]);
  });

  it("sums exactly to the user's daily figure", () => {
    const rows = [
      { model: "claude-opus-4", computedCostCents: 700 },
      { model: "claude-sonnet-4", computedCostCents: 250 },
      { model: "claude-haiku-4-5", computedCostCents: 50 },
    ];

    for (const day of [1, 2, 3, 99, 1_000, 10_007, 32_273]) {
      const shares = distributeAcrossModels(day, rows);
      expect(sum(shares.map((s) => s.costCents))).toBe(day);
      expect(shares.map((s) => s.model)).toEqual(rows.map((r) => r.model));
    }
  });

  it("splits evenly across zero-weight rows", () => {
    const shares = distributeAcrossModels(7, [
      { model: "a", computedCostCents: 0 },
      { model: "b", computedCostCents: 0 },
    ]);

    expect(sum(shares.map((s) => s.costCents))).toBe(7);
    expect(shares.map((s) => s.costCents).sort((a, b) => a - b)).toEqual([3, 4]);
  });

  it("returns nothing when the user has no usage rows", () => {
    // The caller writes a BILLED_ONLY carrier row instead (R10).
    expect(distributeAcrossModels(500, [])).toEqual([]);
    expect(BILLED_ONLY_MODEL).toBe("__billed_only__");
  });

  it("breaks ties by model name, not by input order", () => {
    const rows = [
      { model: "zeta", computedCostCents: 10 },
      { model: "alpha", computedCostCents: 10 },
    ];
    const shares = distributeAcrossModels(1, rows);

    expect(shares.find((s) => s.model === "alpha")?.costCents).toBe(1);
    expect(shares.find((s) => s.model === "zeta")?.costCents).toBe(0);
  });
});

describe("the two passes composed", () => {
  it("still sums to the workspace's billed total", () => {
    // Apportion a day across three owners, then spread each owner's share
    // across their model rows. Nothing may be created or lost at either step.
    const billedCents = 29_2782 % 100000; // an awkward number, not a round one
    const owners = [1, 2, 3];
    const computedByUser = new Map([
      [1, 1234],
      [2, 0],
      [3, 77],
    ]);
    const modelsByUser = new Map([
      [
        1,
        [
          { model: "opus", computedCostCents: 1000 },
          { model: "haiku", computedCostCents: 234 },
        ],
      ],
      [2, [{ model: "sonnet", computedCostCents: 0 }]],
      [
        3,
        [
          { model: "opus", computedCostCents: 70 },
          { model: "sonnet", computedCostCents: 7 },
          { model: "haiku", computedCostCents: 0 },
        ],
      ],
    ]);

    const perUser = attributeDay({ billedCents, owners, computedByUser });
    expect(sum(perUser.map((r) => r.costCents))).toBe(billedCents);

    let grandTotal = 0;
    for (const row of perUser) {
      const shares = distributeAcrossModels(
        row.costCents,
        modelsByUser.get(row.userId)!,
      );
      expect(sum(shares.map((s) => s.costCents))).toBe(row.costCents);
      grandTotal += sum(shares.map((s) => s.costCents));
    }

    expect(grandTotal).toBe(billedCents);
  });
});
