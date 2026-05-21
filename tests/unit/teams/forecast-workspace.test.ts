import { describe, expect, it } from "vitest";
import { forecastWorkspaceMonth } from "@/lib/anthropic/forecast-workspace";

const today = new Date("2026-05-15T14:00:00Z");
const month = "2026-05";

function daysBefore(n: number): string {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function build(daily: number[]): Map<string, number> {
  // daily[0] = oldest, daily[N-1] = today
  const m = new Map<string, number>();
  for (let i = 0; i < daily.length; i++) {
    m.set(daysBefore(daily.length - 1 - i), daily[i]);
  }
  return m;
}

describe("forecastWorkspaceMonth", () => {
  it("returns insufficient_data when < 3 distinct billed days this month", () => {
    const f = forecastWorkspaceMonth(build([100_00, 200_00]), month, today, 1000_00);
    expect(f.status).toBe("insufficient_data");
    expect(f.crossesCapOn).toBeNull();
  });

  it("returns on_track when projected EOM is below cap", () => {
    const f = forecastWorkspaceMonth(build(Array(14).fill(50_00)), month, today, 5000_00);
    expect(f.status).toBe("on_track");
    expect(f.crossesCapOn).toBeNull();
    expect(f.runRate7dCents).toBe(50_00);
  });

  it("returns at_risk and crossesCapOn date when projected to overshoot", () => {
    // 14 days × $100 = $1400 MTD. 7-day rate = $100/day.
    // 16 days remain × $100 = $1600 → projected EOM $3000. Cap $2000.
    // Crosses cap when MTD reaches $2000 → ($2000 - $1400)/$100 = 6 days → May 21.
    const f = forecastWorkspaceMonth(build(Array(14).fill(100_00)), month, today, 2000_00);
    expect(f.status).toBe("at_risk");
    expect(f.runRate7dCents).toBe(100_00);
    expect(f.crossesCapOn).toBe("2026-05-21");
    expect(f.projectedMonthEndCents).toBeGreaterThan(2000_00);
  });

  it("computes week-over-week delta when prior week has spend", () => {
    const f = forecastWorkspaceMonth(
      build([...Array(7).fill(20_00), ...Array(7).fill(40_00)]),
      month,
      today,
      null,
    );
    expect(f.runRate7dCents).toBe(40_00);
    expect(f.runRateWoWPct).toBe(100);
  });

  it("returns null WoW when prior week had < $1 of spend", () => {
    const f = forecastWorkspaceMonth(
      build([...Array(7).fill(0), ...Array(7).fill(40_00)]),
      month,
      today,
      null,
    );
    expect(f.runRateWoWPct).toBeNull();
  });

  it("treats null limitCents as on_track regardless of projection", () => {
    const f = forecastWorkspaceMonth(build(Array(14).fill(1_000_00)), month, today, null);
    expect(f.status).toBe("on_track");
    expect(f.crossesCapOn).toBeNull();
  });

  it("returns null crossesCapOn when already over cap (breach card handles it)", () => {
    const f = forecastWorkspaceMonth(build(Array(14).fill(300_00)), month, today, 2000_00);
    expect(f.status).toBe("at_risk");
    expect(f.crossesCapOn).toBeNull();
  });
});
