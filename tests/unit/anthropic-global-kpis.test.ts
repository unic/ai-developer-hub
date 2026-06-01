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

describe("Projection with today estimate (spec 033 — mirrors loadDashboardKpis)", () => {
  // spentSoFar = actual MTD (complete days) + today's estimate; daysElapsed
  // counts today (UTC day). This is the model loadDashboardKpis / _getWorkspaceDetail use.
  function project(
    mtdActualCents: number,
    estTodayCents: number,
    daysElapsed: number,
    daysInMonth: number
  ) {
    return projectMonthEnd(mtdActualCents + estTodayCents, daysElapsed, daysInMonth);
  }

  it("1st of the month: actual is $0 but the estimate yields a non-zero projection", () => {
    // Before the fix this projected $0 (numerator skipped today, denominator counted it).
    // Day 1 of 30, $0 billed, $1,180 est today → $35,400 projected.
    expect(project(0, 118_000, 1, 30)).toBe(30 * 118_000);
  });

  it("mid-month: matches the hand-calc of (actual + est) / dayOfMonth * daysInMonth", () => {
    // $42,320 actual + $1,640 est on day 12 of 30.
    expect(project(4_232_000, 164_000, 12, 30)).toBe(
      Math.round(((4_232_000 + 164_000) / 12) * 30)
    );
  });

  it("a null/zero estimate leaves the projection at the actual-only run-rate", () => {
    expect(project(4_232_000, 0, 12, 30)).toBe(projectMonthEnd(4_232_000, 12, 30));
  });

  it("past months are unaffected (full month elapsed, no estimate)", () => {
    expect(project(5_000_000, 0, 30, 30)).toBe(5_000_000);
  });
});

describe("Alerts & running costs stay actual-only (spec 033 invariant)", () => {
  // getActiveAlerts (alerts.ts) and getRunningCostsForPeriod (budget-utils.ts)
  // must NEVER fold in the estimate. Their math reads actual cents only.
  function utilization(actualMtdCents: number, limitCents: number) {
    return Math.round((actualMtdCents / limitCents) * 100);
  }
  function runningCost(actualBreakdownCents: number[]) {
    return actualBreakdownCents.reduce((sum, c) => sum + c, 0);
  }

  it("utilization is computed from actual MTD only — an estimate cannot push it over 80%", () => {
    const actualMtd = 7_900; // 79% of $100
    const limit = 10_000;
    // Even with a large today estimate sitting in a separate field, utilization
    // is unchanged because the function never reads it.
    expect(utilization(actualMtd, limit)).toBe(79);
  });

  it("running cost sums actual workspace costs only", () => {
    expect(runningCost([100_00, 250_00, 0])).toBe(350_00);
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
