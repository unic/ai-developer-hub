import { describe, it, expect } from "vitest";
import { forecastBudget } from "@/lib/forecast";
import type { MonthlySpend } from "@/types";

const TODAY = new Date("2026-03-05");

function makeHistory(values: number[]): MonthlySpend[] {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return values.map((v, i) => ({
    month: `${months[i % 12]} ${2025 + Math.floor(i / 12)}`,
    amountCents: v,
  }));
}

describe("forecastBudget", () => {
  it("returns insufficientData when history has fewer than 3 months", () => {
    const result = forecastBudget({
      history: makeHistory([10000, 12000]),
      actualSpendToDateCents: 22000,
      budgetCeilingCents: 120000,
      today: TODAY,
    });

    expect(result.insufficientData).toBeDefined();
    expect(result.projections).toHaveLength(0);
    expect(result.projectedRemainingCents).toBe(0);
  });

  it("returns on_track status when insufficientData and spend is below ceiling", () => {
    const result = forecastBudget({
      history: makeHistory([10000]),
      actualSpendToDateCents: 10000,
      budgetCeilingCents: 120000,
      today: TODAY,
    });

    expect(result.status).toBe("on_track");
  });

  it("returns at_risk status when insufficientData and spend exceeds ceiling", () => {
    const result = forecastBudget({
      history: makeHistory([10000]),
      actualSpendToDateCents: 130000,
      budgetCeilingCents: 120000,
      today: TODAY,
    });

    expect(result.status).toBe("at_risk");
  });

  it("runs OLS with valid 3-month history and produces 3 projections by default", () => {
    const history = makeHistory([10000, 11000, 12000]);
    const result = forecastBudget({
      history,
      actualSpendToDateCents: 33000,
      budgetCeilingCents: 200000,
      today: TODAY,
    });

    expect(result.insufficientData).toBeUndefined();
    expect(result.projections).toHaveLength(3);
    expect(result.slopeCents).toBeCloseTo(1000, 0);
  });

  it("projects 6 months when monthsToProject=6", () => {
    const history = makeHistory([10000, 11000, 12000, 13000]);
    const result = forecastBudget({
      history,
      monthsToProject: 6,
      actualSpendToDateCents: 46000,
      budgetCeilingCents: 200000,
      today: TODAY,
    });

    expect(result.projections).toHaveLength(6);
  });

  it("clamps monthsToProject to [3, 6]", () => {
    const history = makeHistory([10000, 11000, 12000]);
    const low = forecastBudget({
      history,
      monthsToProject: 1,
      actualSpendToDateCents: 33000,
      budgetCeilingCents: 200000,
      today: TODAY,
    });
    const high = forecastBudget({
      history,
      monthsToProject: 10,
      actualSpendToDateCents: 33000,
      budgetCeilingCents: 200000,
      today: TODAY,
    });

    expect(low.projections).toHaveLength(3);
    expect(high.projections).toHaveLength(6);
  });

  it("floors negative projected values at 0", () => {
    // Steep downward trend leading to negative projections
    const history = makeHistory([100000, 50000, 10000]);
    const result = forecastBudget({
      history,
      monthsToProject: 3,
      actualSpendToDateCents: 160000,
      budgetCeilingCents: 500000,
      today: TODAY,
    });

    for (const p of result.projections) {
      expect(p.projectedAmountCents).toBeGreaterThanOrEqual(0);
    }
  });

  it("all-zero history produces zero projections", () => {
    const history = makeHistory([0, 0, 0, 0]);
    const result = forecastBudget({
      history,
      actualSpendToDateCents: 0,
      budgetCeilingCents: 100000,
      today: TODAY,
    });

    expect(result.insufficientData).toBeUndefined();
    for (const p of result.projections) {
      expect(p.projectedAmountCents).toBe(0);
    }
  });

  it("sets status=on_track when projectedAnnualTotal <= ceiling", () => {
    const history = makeHistory([5000, 5000, 5000]);
    const result = forecastBudget({
      history,
      actualSpendToDateCents: 15000,
      budgetCeilingCents: 100000,
      today: TODAY,
    });

    expect(result.status).toBe("on_track");
    expect(result.projectedAnnualTotalCents).toBeLessThanOrEqual(100000);
  });

  it("sets status=at_risk when projectedAnnualTotal > ceiling", () => {
    const history = makeHistory([30000, 40000, 50000]);
    const result = forecastBudget({
      history,
      actualSpendToDateCents: 120000,
      budgetCeilingCents: 200000,
      today: TODAY,
    });

    expect(result.status).toBe("at_risk");
    expect(result.projectedAnnualTotalCents).toBeGreaterThan(200000);
  });

  it("all returned monetary values are integers", () => {
    const history = makeHistory([10001, 10002, 10003, 10007]);
    const result = forecastBudget({
      history,
      actualSpendToDateCents: 40013,
      budgetCeilingCents: 200000,
      today: TODAY,
    });

    expect(Number.isInteger(result.slopeCents)).toBe(true);
    expect(Number.isInteger(result.interceptCents)).toBe(true);
    expect(Number.isInteger(result.projectedRemainingCents)).toBe(true);
    expect(Number.isInteger(result.projectedAnnualTotalCents)).toBe(true);
    for (const p of result.projections) {
      expect(Number.isInteger(p.projectedAmountCents)).toBe(true);
    }
  });

  it("generates correct month labels for projections", () => {
    // History ending in Dec 2025 — projections should start Jan 2026
    const history: MonthlySpend[] = [
      { month: "Oct 2025", amountCents: 10000 },
      { month: "Nov 2025", amountCents: 11000 },
      { month: "Dec 2025", amountCents: 12000 },
    ];
    const result = forecastBudget({
      history,
      monthsToProject: 3,
      actualSpendToDateCents: 33000,
      budgetCeilingCents: 200000,
      today: TODAY,
    });

    expect(result.projections[0].month).toBe("Jan 2026");
    expect(result.projections[1].month).toBe("Feb 2026");
    expect(result.projections[2].month).toBe("Mar 2026");
  });
});
