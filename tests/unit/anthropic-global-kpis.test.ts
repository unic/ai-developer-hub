import { describe, it, expect } from "vitest";
import { projectMonthEnd } from "@/lib/utils";

describe("projectMonthEnd", () => {
  it("returns 0 when no days have elapsed", () => {
    expect(projectMonthEnd(50_000, 0, 31)).toBe(0);
  });

  it("linearly extrapolates mid-month spending to full month", () => {
    expect(projectMonthEnd(15_000, 15, 30)).toBe(30_000);
  });

  it("equals total when days elapsed equals days in month", () => {
    expect(projectMonthEnd(42_000, 30, 30)).toBe(42_000);
  });

  it("rounds to the nearest cent", () => {
    expect(projectMonthEnd(10_000, 3, 31)).toBe(103_333);
  });

  it("handles a 28-day February", () => {
    expect(projectMonthEnd(7_000, 7, 28)).toBe(28_000);
  });
});

describe("MoM math (mirrors getDashboardKpis)", () => {
  function mom(curr: number, prior: number) {
    const delta = curr - prior;
    const pct = prior < 100 ? null : Math.round((delta / prior) * 100);
    return { delta, pct };
  }

  it("returns null pct when prior month is below $1 floor", () => {
    expect(mom(50_000, 99).pct).toBeNull();
    expect(mom(50_000, 0).pct).toBeNull();
  });

  it("computes positive percent delta correctly", () => {
    expect(mom(120_000, 100_000)).toEqual({ delta: 20_000, pct: 20 });
  });

  it("computes negative percent delta correctly", () => {
    expect(mom(80_000, 100_000)).toEqual({ delta: -20_000, pct: -20 });
  });
});

describe("Over-80% counting (mirrors getDashboardKpis loop)", () => {
  type Row = { limitCents: number; currentCents: number };
  function over80({ limitCents, currentCents }: Row): boolean {
    if (limitCents <= 0) return false;
    return Math.round((currentCents / limitCents) * 100) >= 80;
  }

  it("counts at exactly 80%", () => {
    expect(over80({ limitCents: 10_000, currentCents: 8_000 })).toBe(true);
  });

  it("does not count at 79%", () => {
    expect(over80({ limitCents: 10_000, currentCents: 7_900 })).toBe(false);
  });

  it("counts at 100%+", () => {
    expect(over80({ limitCents: 10_000, currentCents: 12_500 })).toBe(true);
  });
});

describe("Sync staleness boundary (mirrors getSyncStatus)", () => {
  const STALE_MINUTES = 70;
  function isStale(ageMinutes: number): boolean {
    return ageMinutes > STALE_MINUTES;
  }
  it("70 minutes is still fresh", () => {
    expect(isStale(70)).toBe(false);
  });
  it("71 minutes is stale", () => {
    expect(isStale(71)).toBe(true);
  });
});
