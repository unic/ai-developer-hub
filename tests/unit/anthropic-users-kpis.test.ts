import { describe, it, expect } from "vitest";
import {
  topNConcentrationPct,
  activeUserDeltaPct,
  countUsersWithNoApiKey,
} from "@/lib/anthropic-users-utils";

describe("topNConcentrationPct (Top-5 concentration)", () => {
  it("returns null when total is zero (no spend → undefined ratio)", () => {
    expect(topNConcentrationPct([], 0, 5)).toBeNull();
    expect(topNConcentrationPct([0, 0, 0], 0, 5)).toBeNull();
  });

  it("returns 100 when a single user is the entire spend", () => {
    expect(topNConcentrationPct([1000], 1000, 5)).toBe(100);
  });

  it("handles fewer rows than N (4 users, ask for top 5)", () => {
    const costs = [400, 300, 200, 100];
    const total = 1000;
    expect(topNConcentrationPct(costs, total, 5)).toBe(100);
  });

  it("excludes the long tail when there are more than N users", () => {
    // 5 power users sum to 800, tail sums to 200 → 80%
    const costs = [200, 180, 160, 140, 120, 100, 60, 30, 10];
    const total = costs.reduce((a, b) => a + b, 0);
    expect(topNConcentrationPct(costs, total, 5)).toBe(80);
  });

  it("returns null when total is negative (defensive)", () => {
    expect(topNConcentrationPct([100], -1, 5)).toBeNull();
  });
});

describe("activeUserDeltaPct (MoM user count math)", () => {
  it("returns null when prior is zero (first month → no baseline)", () => {
    expect(activeUserDeltaPct(10, 0)).toBeNull();
  });

  it("computes positive growth correctly", () => {
    expect(activeUserDeltaPct(12, 10)).toBe(20);
    expect(activeUserDeltaPct(20, 10)).toBe(100);
  });

  it("computes negative shrinkage correctly", () => {
    expect(activeUserDeltaPct(8, 10)).toBe(-20);
  });

  it("returns 0 when count is unchanged", () => {
    expect(activeUserDeltaPct(10, 10)).toBe(0);
  });

  it("rounds to the nearest integer", () => {
    // 13 / 12 ≈ 1.0833 → 8.33...% → rounds to 8
    expect(activeUserDeltaPct(13, 12)).toBe(8);
  });
});

describe("countUsersWithNoApiKey (denominator math)", () => {
  it("counts only active Boost-profile users (status + profile filter)", () => {
    const rows = [
      { status: "active" as const, profile: "boost" as const, hasApiKey: false },
      { status: "inactive" as const, profile: "boost" as const, hasApiKey: false },
      { status: "active" as const, profile: "boost" as const, hasApiKey: true },
    ];
    const { numerator, denominator } = countUsersWithNoApiKey(rows);
    expect(denominator).toBe(2); // 2 active Boost users
    expect(numerator).toBe(1); // 1 active Boost user without an API key
  });

  it("excludes non-Boost profiles from both numerator and denominator", () => {
    // Only Boost users are intended to hold an API key — maxed, indie, and
    // null profiles must not bloat the cohort.
    const rows = [
      { status: "active" as const, profile: "boost" as const, hasApiKey: true },
      { status: "active" as const, profile: "maxed" as const, hasApiKey: false },
      { status: "active" as const, profile: "indie" as const, hasApiKey: false },
      { status: "active" as const, profile: null, hasApiKey: false },
    ];
    expect(countUsersWithNoApiKey(rows)).toEqual({
      numerator: 0,
      denominator: 1, // only the one Boost user counts
    });
  });

  it("returns 0/0 for an empty input", () => {
    expect(countUsersWithNoApiKey([])).toEqual({ numerator: 0, denominator: 0 });
  });

  it("returns 0/N when all active Boost users have an API key", () => {
    const rows = [
      { status: "active" as const, profile: "boost" as const, hasApiKey: true },
      { status: "active" as const, profile: "boost" as const, hasApiKey: true },
    ];
    expect(countUsersWithNoApiKey(rows)).toEqual({ numerator: 0, denominator: 2 });
  });

  it("returns N/N when no active Boost user has an API key", () => {
    const rows = [
      { status: "active" as const, profile: "boost" as const, hasApiKey: false },
      { status: "active" as const, profile: "boost" as const, hasApiKey: false },
      { status: "inactive" as const, profile: "boost" as const, hasApiKey: false }, // excluded
      { status: "active" as const, profile: "maxed" as const, hasApiKey: false }, // excluded
    ];
    expect(countUsersWithNoApiKey(rows)).toEqual({ numerator: 2, denominator: 2 });
  });
});
