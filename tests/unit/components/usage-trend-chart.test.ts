import { describe, it, expect } from "vitest";
import { isUsageTrendSparse } from "@/lib/copilot-chart-utils";
import type { TrendDataPoint } from "@/lib/copilot-chart-utils";

function makePoint(overrides?: Partial<TrendDataPoint>): TrendDataPoint {
  return {
    date: "2025-01-01",
    suggestions: 0,
    acceptances: 0,
    activeUsers: 0,
    acceptanceRate: 0,
    ...overrides,
  };
}

describe("isUsageTrendSparse", () => {
  it("returns true for empty array", () => {
    expect(isUsageTrendSparse([])).toBe(true);
  });

  it("returns true for single-row array even with non-zero values", () => {
    expect(
      isUsageTrendSparse([
        makePoint({ suggestions: 10, acceptances: 5, activeUsers: 3 }),
      ])
    ).toBe(true);
  });

  it("returns true for 7 all-zero rows", () => {
    const data = Array.from({ length: 7 }, (_, i) =>
      makePoint({ date: `2025-01-0${i + 1}` })
    );
    expect(isUsageTrendSparse(data)).toBe(true);
  });

  it("returns false for 2+ rows with non-zero values", () => {
    const data = [
      makePoint({ date: "2025-01-01", suggestions: 10, acceptances: 5, activeUsers: 3 }),
      makePoint({ date: "2025-01-02", suggestions: 8, acceptances: 4, activeUsers: 2 }),
    ];
    expect(isUsageTrendSparse(data)).toBe(false);
  });

  it("returns false when at least one row has non-zero values among multiple rows", () => {
    const data = [
      makePoint({ date: "2025-01-01" }),
      makePoint({ date: "2025-01-02", suggestions: 5 }),
    ];
    expect(isUsageTrendSparse(data)).toBe(false);
  });
});
