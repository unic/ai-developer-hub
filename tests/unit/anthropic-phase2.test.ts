import { describe, it, expect } from "vitest";

// These tests mirror the pure-math portions of Phase 2 server actions so they
// can run without a live database. The SQL itself is covered in the e2e tests.

describe("Top Movers ranking + $5 floor", () => {
  type Bucket = { workspaceId: string; old: number; new: number };
  function rank(rows: Bucket[]): { workspaceId: string; deltaPct: number }[] {
    const out: { workspaceId: string; deltaPct: number }[] = [];
    for (const r of rows) {
      if (r.old < 500) continue;
      const delta = r.new - r.old;
      if (delta <= 0) continue;
      out.push({ workspaceId: r.workspaceId, deltaPct: Math.round((delta / r.old) * 100) });
    }
    return out.sort((a, b) => b.deltaPct - a.deltaPct).slice(0, 3);
  }

  it("excludes workspaces whose prior period is below $5", () => {
    const ranked = rank([
      { workspaceId: "a", old: 100, new: 999 }, // <$5 prior → skipped
      { workspaceId: "b", old: 600, new: 1_200 },
    ]);
    expect(ranked.map((r) => r.workspaceId)).toEqual(["b"]);
  });

  it("excludes workspaces whose delta is negative or zero", () => {
    const ranked = rank([
      { workspaceId: "down", old: 1_000, new: 800 },
      { workspaceId: "flat", old: 1_000, new: 1_000 },
      { workspaceId: "up", old: 1_000, new: 1_500 },
    ]);
    expect(ranked.map((r) => r.workspaceId)).toEqual(["up"]);
  });

  it("returns at most 3 workspaces sorted by deltaPct DESC", () => {
    const ranked = rank([
      { workspaceId: "a", old: 1_000, new: 2_000 },     // +100%
      { workspaceId: "b", old: 1_000, new: 1_500 },     // +50%
      { workspaceId: "c", old: 1_000, new: 5_000 },     // +400%
      { workspaceId: "d", old: 1_000, new: 3_000 },     // +200%
      { workspaceId: "e", old: 1_000, new: 1_100 },     // +10%
    ]);
    expect(ranked.map((r) => r.workspaceId)).toEqual(["c", "d", "a"]);
  });
});

describe("Cumulative pacing math", () => {
  function cumulate(daily: number[]): number[] {
    const out: number[] = [];
    let acc = 0;
    for (const v of daily) {
      acc += v;
      out.push(acc);
    }
    return out;
  }

  it("monotonically increases (or stays flat)", () => {
    const c = cumulate([100, 200, 0, 50]);
    expect(c).toEqual([100, 300, 300, 350]);
  });

  it("final value equals the sum of the inputs", () => {
    const inputs = [10, 20, 30, 40];
    const c = cumulate(inputs);
    expect(c[c.length - 1]).toBe(inputs.reduce((a, b) => a + b, 0));
  });
});

describe("12-month bucketing", () => {
  function bucketByMonth(rows: { date: string; cents: number }[]) {
    const out = new Map<string, number>();
    for (const r of rows) {
      const month = r.date.slice(0, 7);
      out.set(month, (out.get(month) ?? 0) + r.cents);
    }
    return Array.from(out.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, cents]) => ({ month, totalCents: cents }));
  }

  it("groups daily rows into per-month totals across a year boundary", () => {
    const rows = [
      { date: "2025-12-31", cents: 100 },
      { date: "2026-01-01", cents: 200 },
      { date: "2026-01-15", cents: 50 },
      { date: "2026-02-01", cents: 75 },
    ];
    expect(bucketByMonth(rows)).toEqual([
      { month: "2025-12", totalCents: 100 },
      { month: "2026-01", totalCents: 250 },
      { month: "2026-02", totalCents: 75 },
    ]);
  });
});
