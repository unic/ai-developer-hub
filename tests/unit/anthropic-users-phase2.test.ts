import { describe, it, expect } from "vitest";
import {
  bucketCents,
  COST_DISTRIBUTION_BUCKETS,
} from "@/lib/claude-users-buckets";
import {
  rankUserTopMovers,
  USER_TOP_MOVERS_FLOOR_CENTS,
} from "@/lib/anthropic-users-utils";

// ---------------------------------------------------------------------------
// Cost-distribution bucket boundaries (T201 / T206)
//
// The SQL boundaries live in `claude-users-buckets.ts`; these tests pin the
// inclusive / exclusive edges around every boundary so a future edit that
// shifts (e.g.) "<$1" by one cent in the SQL but forgets to update the JS
// classifier (or vice versa) will fail loudly here.
// ---------------------------------------------------------------------------

describe("bucketCents — cost-distribution bucket boundaries", () => {
  it("classifies exactly $0 (0 cents) as the 'zero' bucket", () => {
    expect(bucketCents(0)).toBe("zero");
  });

  it("classifies a single cent as 'lt1' (the $0.01–$1 bucket)", () => {
    expect(bucketCents(1)).toBe("lt1");
  });

  it("classifies $0.99 (99 cents) as 'lt1'", () => {
    expect(bucketCents(99)).toBe("lt1");
  });

  it("classifies $1.00 exactly as 'lt10' (boundary is exclusive on the upper edge of lt1)", () => {
    expect(bucketCents(100)).toBe("lt10");
  });

  it("classifies $9.99 as 'lt10'", () => {
    expect(bucketCents(999)).toBe("lt10");
  });

  it("classifies $10.00 exactly as 'lt50'", () => {
    expect(bucketCents(1_000)).toBe("lt50");
  });

  it("classifies $49.99 as 'lt50'", () => {
    expect(bucketCents(4_999)).toBe("lt50");
  });

  it("classifies $50.00 exactly as 'lt100'", () => {
    expect(bucketCents(5_000)).toBe("lt100");
  });

  it("classifies $99.99 as 'lt100'", () => {
    expect(bucketCents(9_999)).toBe("lt100");
  });

  it("classifies $100.00 exactly as 'gte100'", () => {
    expect(bucketCents(10_000)).toBe("gte100");
  });

  it("classifies $100.01 as 'gte100'", () => {
    expect(bucketCents(10_001)).toBe("gte100");
  });

  it("classifies a very large value as 'gte100' (no upper bound)", () => {
    expect(bucketCents(1_000_000)).toBe("gte100");
  });

  it("treats negative cents defensively as 'zero' (should never occur in real data)", () => {
    expect(bucketCents(-1)).toBe("zero");
  });

  it("exports exactly 6 buckets in the canonical order", () => {
    expect(COST_DISTRIBUTION_BUCKETS.map((b) => b.key)).toEqual([
      "zero",
      "lt1",
      "lt10",
      "lt50",
      "lt100",
      "gte100",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Sparkline pivot integrity (T202 / T206)
//
// The action returns `Record<userId, { month, totalCents }[]>` — verify a
// hand-built input pivots cleanly: 3 users × up-to-3 months → expected shape.
// ---------------------------------------------------------------------------

describe("user sparkline pivot integrity", () => {
  type Row = { user_id: number; month: string; cents: number };

  /** Mirrors the pivot loop in `_getUserSparklines` so the shape contract is testable. */
  function pivot(rows: Row[]): Record<number, { month: string; totalCents: number }[]> {
    const out: Record<number, { month: string; totalCents: number }[]> = {};
    for (const r of rows) {
      if (!out[r.user_id]) out[r.user_id] = [];
      out[r.user_id].push({ month: r.month, totalCents: r.cents });
    }
    return out;
  }

  it("groups rows by userId with per-month entries preserved in input order", () => {
    const rows: Row[] = [
      { user_id: 1, month: "2026-01", cents: 100 },
      { user_id: 1, month: "2026-02", cents: 250 },
      { user_id: 1, month: "2026-03", cents: 0 },
      { user_id: 2, month: "2026-02", cents: 500 },
      { user_id: 2, month: "2026-03", cents: 1_500 },
      { user_id: 3, month: "2026-03", cents: 75 },
    ];
    const pivoted = pivot(rows);
    expect(Object.keys(pivoted).sort()).toEqual(["1", "2", "3"]);
    expect(pivoted[1]).toEqual([
      { month: "2026-01", totalCents: 100 },
      { month: "2026-02", totalCents: 250 },
      { month: "2026-03", totalCents: 0 },
    ]);
    expect(pivoted[2]).toEqual([
      { month: "2026-02", totalCents: 500 },
      { month: "2026-03", totalCents: 1_500 },
    ]);
    expect(pivoted[3]).toEqual([
      { month: "2026-03", totalCents: 75 },
    ]);
  });

  it("handles 6 users × 3 months → 18 entries spread across 6 keys", () => {
    const rows: Row[] = [];
    for (let uid = 1; uid <= 6; uid++) {
      for (const m of ["2026-01", "2026-02", "2026-03"]) {
        rows.push({ user_id: uid, month: m, cents: uid * 100 });
      }
    }
    const pivoted = pivot(rows);
    expect(Object.keys(pivoted)).toHaveLength(6);
    for (let uid = 1; uid <= 6; uid++) {
      expect(pivoted[uid]).toHaveLength(3);
      expect(pivoted[uid].every((r) => r.totalCents === uid * 100)).toBe(true);
    }
  });

  it("returns an empty record when there are no rows", () => {
    expect(pivot([])).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Top-movers ranking (T203 / T206)
//
// Same rules as the workspace version (`anthropic-phase2.test.ts`) — pin them
// against the shared helper so the two surfaces stay aligned.
// ---------------------------------------------------------------------------

describe("rankUserTopMovers — ranking + $5 floor + positive-only", () => {
  it(`excludes users whose priorCents is below $${USER_TOP_MOVERS_FLOOR_CENTS / 100}`, () => {
    const ranked = rankUserTopMovers([
      { userId: 1, name: "Alice", email: "a@x", priorCents: 100, recentCents: 999 }, // $1 prior → skipped
      { userId: 2, name: "Bob", email: "b@x", priorCents: 600, recentCents: 1_200 },
    ]);
    expect(ranked.map((r) => r.userId)).toEqual([2]);
  });

  it("excludes users whose delta is negative or zero", () => {
    const ranked = rankUserTopMovers([
      { userId: 1, name: "Down", email: "d@x", priorCents: 1_000, recentCents: 800 },
      { userId: 2, name: "Flat", email: "f@x", priorCents: 1_000, recentCents: 1_000 },
      { userId: 3, name: "Up", email: "u@x", priorCents: 1_000, recentCents: 1_500 },
    ]);
    expect(ranked.map((r) => r.userId)).toEqual([3]);
  });

  it("returns at most 3 users sorted by deltaPct DESC", () => {
    const ranked = rankUserTopMovers([
      { userId: 1, name: "A", email: "a@x", priorCents: 1_000, recentCents: 2_000 }, // +100%
      { userId: 2, name: "B", email: "b@x", priorCents: 1_000, recentCents: 1_500 }, // +50%
      { userId: 3, name: "C", email: "c@x", priorCents: 1_000, recentCents: 5_000 }, // +400%
      { userId: 4, name: "D", email: "d@x", priorCents: 1_000, recentCents: 3_000 }, // +200%
      { userId: 5, name: "E", email: "e@x", priorCents: 1_000, recentCents: 1_100 }, // +10%
    ]);
    expect(ranked.map((r) => r.userId)).toEqual([3, 4, 1]);
    expect(ranked.map((r) => r.deltaPct)).toEqual([400, 200, 100]);
  });

  it("breaks deltaPct ties by email ASC for determinism", () => {
    const ranked = rankUserTopMovers([
      { userId: 10, name: "Beta", email: "beta@x", priorCents: 1_000, recentCents: 2_000 }, // +100%
      { userId: 11, name: "Alpha", email: "alpha@x", priorCents: 1_000, recentCents: 2_000 }, // +100%
    ]);
    expect(ranked.map((r) => r.userId)).toEqual([11, 10]);
  });

  it("returns an empty array when nothing crosses the floor", () => {
    expect(
      rankUserTopMovers([
        { userId: 1, name: "Trace", email: "t@x", priorCents: 0, recentCents: 10 },
      ])
    ).toEqual([]);
  });
});
