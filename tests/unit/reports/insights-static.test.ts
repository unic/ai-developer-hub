import { describe, expect, it } from "vitest";
import {
  getStaticInsights,
  type InsightInput,
} from "@/lib/reports/insights-static";

function baseInput(overrides: Partial<InsightInput> = {}): InsightInput {
  return {
    current: {
      activeLicenses: 100,
      expectedMonthlyCents: 100_000,
      licensesByTool: new Map(),
    },
    previous: null,
    budget: null,
    lastMonthVariancePct: null,
    lastMonthLabel: null,
    ...overrides,
  };
}

describe("getStaticInsights", () => {
  it("returns no insights when nothing is comparable", () => {
    expect(getStaticInsights(baseInput())).toEqual([]);
  });

  it("emits a budget-at-risk card with overage amount", () => {
    const insights = getStaticInsights(
      baseInput({
        budget: {
          status: "at_risk",
          projectedAnnualTotalCents: 60_000_00,
          budgetCeilingCents: 40_000_00,
        },
      })
    );
    expect(insights).toHaveLength(1);
    expect(insights[0]).toMatchObject({
      key: "budget-at-risk",
      severity: "danger",
      icon: "warn",
    });
    expect(insights[0].headline).toContain("at risk");
  });

  it("emits an on-track card when status is on_track", () => {
    const insights = getStaticInsights(
      baseInput({
        budget: {
          status: "on_track",
          projectedAnnualTotalCents: 30_000_00,
          budgetCeilingCents: 40_000_00,
        },
      })
    );
    expect(insights[0]).toMatchObject({ key: "budget-on-track", severity: "info" });
  });

  it("skips license-mover insights below the 5-seat / 20% threshold", () => {
    const previous = {
      activeLicenses: 30,
      expectedMonthlyCents: 100_000,
      licensesByTool: new Map([[1, { name: "Claude", count: 30 }]]),
    };
    const current = {
      activeLicenses: 32,
      expectedMonthlyCents: 100_000,
      licensesByTool: new Map([[1, { name: "Claude", count: 32 }]]),
    };
    const insights = getStaticInsights(baseInput({ current, previous }));
    expect(insights.find((i) => i.key.startsWith("licenses-"))).toBeUndefined();
  });

  it("emits a top-license-mover card for a significant gain", () => {
    const previous = {
      activeLicenses: 10,
      expectedMonthlyCents: 50_000,
      licensesByTool: new Map([[1, { name: "Claude", count: 10 }]]),
    };
    const current = {
      activeLicenses: 25,
      expectedMonthlyCents: 100_000,
      licensesByTool: new Map([[1, { name: "Claude", count: 25 }]]),
    };
    const insights = getStaticInsights(baseInput({ current, previous }));
    const mover = insights.find((i) => i.key === "licenses-up-1");
    expect(mover).toBeDefined();
    expect(mover!.headline).toContain("Claude");
    expect(mover!.headline).toContain("10 → 25");
  });

  it("treats a fully off-boarded tool as a downward mover", () => {
    const previous = {
      activeLicenses: 8,
      expectedMonthlyCents: 50_000,
      licensesByTool: new Map([[7, { name: "Replit Teams", count: 8 }]]),
    };
    const current = {
      activeLicenses: 0,
      expectedMonthlyCents: 0,
      licensesByTool: new Map(),
    };
    const insights = getStaticInsights(baseInput({ current, previous }));
    const downMover = insights.find((i) => i.key === "licenses-down-7");
    expect(downMover).toBeDefined();
    expect(downMover!.headline).toContain("8 → 0");
  });

  it("emits a spend MoM card when the change exceeds 10%", () => {
    const previous = {
      activeLicenses: 100,
      expectedMonthlyCents: 100_000,
      licensesByTool: new Map(),
    };
    const current = {
      activeLicenses: 100,
      expectedMonthlyCents: 130_000,
      licensesByTool: new Map(),
    };
    const insights = getStaticInsights(baseInput({ current, previous }));
    const spend = insights.find((i) => i.key.startsWith("spend-"));
    expect(spend?.key).toBe("spend-up");
    expect(spend?.headline).toContain("30.0%");
  });

  it("emits a past-month variance card when |pct| ≥ 5%", () => {
    const insights = getStaticInsights(
      baseInput({
        lastMonthLabel: "Apr 2026",
        lastMonthVariancePct: 22.3,
      })
    );
    const variance = insights.find((i) => i.key === "past-month-variance");
    expect(variance).toBeDefined();
    expect(variance!.headline).toContain("Apr 2026");
    expect(variance!.headline).toContain("22.3% over");
  });

  it("skips the variance card for trivial swings (<5%)", () => {
    const insights = getStaticInsights(
      baseInput({ lastMonthLabel: "Apr 2026", lastMonthVariancePct: 2 })
    );
    expect(insights.find((i) => i.key === "past-month-variance")).toBeUndefined();
  });

  it("caps the output at four insights in priority order", () => {
    const previous = {
      activeLicenses: 10,
      expectedMonthlyCents: 80_000,
      licensesByTool: new Map([
        [1, { name: "Tool A", count: 10 }],
        [2, { name: "Tool B", count: 20 }],
      ]),
    };
    const current = {
      activeLicenses: 30,
      expectedMonthlyCents: 150_000,
      licensesByTool: new Map([
        [1, { name: "Tool A", count: 30 }],
        [2, { name: "Tool B", count: 0 }],
      ]),
    };
    const insights = getStaticInsights(
      baseInput({
        current,
        previous,
        budget: {
          status: "at_risk",
          projectedAnnualTotalCents: 60_000_00,
          budgetCeilingCents: 40_000_00,
        },
        lastMonthLabel: "Apr 2026",
        lastMonthVariancePct: 15,
      })
    );
    expect(insights).toHaveLength(4);
    expect(insights[0].key).toBe("budget-at-risk");
  });
});
