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

  // Spec 033 — today estimate fills the missing cost_report slot.
  it("fills today's missing slot with the estimate, lifting the 7-day run-rate", () => {
    // 7 complete days before today @ $100, NO today row in cost_report.
    const daily = new Map<string, number>();
    for (let i = 1; i <= 7; i++) daily.set(daysBefore(i), 100_00);

    const without = forecastWorkspaceMonth(daily, month, today, null);
    const withEst = forecastWorkspaceMonth(daily, month, today, null, 700_00);

    // last7 = [today-6..today-1, today]; today is 0 without, 700_00 with.
    expect(without.runRate7dCents).toBe(Math.round(600_00 / 7));
    expect(withEst.runRate7dCents).toBe(Math.round(1_300_00 / 7));
    expect(withEst.projectedMonthEndCents).toBeGreaterThan(
      without.projectedMonthEndCents,
    );
  });

  it("does not double-count the estimate when cost_report already has today", () => {
    const daily = build(Array(8).fill(100_00)); // includes a real today row
    const without = forecastWorkspaceMonth(daily, month, today, null);
    const withEst = forecastWorkspaceMonth(daily, month, today, null, 999_00);
    expect(withEst.runRate7dCents).toBe(without.runRate7dCents);
    expect(withEst.projectedMonthEndCents).toBe(without.projectedMonthEndCents);
  });

  it("defaulting the estimate to 0 preserves the original behavior", () => {
    const daily = build(Array(14).fill(50_00));
    const explicitZero = forecastWorkspaceMonth(daily, month, today, 5000_00, 0);
    const omitted = forecastWorkspaceMonth(daily, month, today, 5000_00);
    expect(explicitZero).toEqual(omitted);
  });

  // Regression: cost_report keys dates in UTC. At 23:30 UTC on May 31, a UTC+
  // runtime is already on June 1 locally — the forecast must still key "today"
  // to the UTC day (May 31) so the estimate counts toward the right month.
  it("keys 'today' in UTC at a month boundary, not local time", () => {
    const lateMayUtc = new Date("2026-05-31T23:30:00Z");
    const f = forecastWorkspaceMonth(new Map(), "2026-05", lateMayUtc, null, 300_00);
    // UTC day 31 of 31 → daysRemaining 0 → projected == MTD == the estimate.
    // (If "today" were taken as local June 1, the estimate would fall outside
    // May's MTD window and projected would be 0.)
    expect(f.projectedMonthEndCents).toBe(300_00);
  });
});
