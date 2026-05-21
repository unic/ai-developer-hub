import { describe, expect, it } from "vitest";
import { fmtAgo, fmtDeltaPct, fmtMoney, fmtPct } from "@/lib/teams/format";

describe("fmtMoney", () => {
  it("formats whole-dollar cents without decimals", () => {
    expect(fmtMoney(184_2000)).toBe("$18,420");
    expect(fmtMoney(0)).toBe("$0");
  });
});

describe("fmtPct", () => {
  it("renders integer percent with sign", () => {
    expect(fmtPct(84)).toBe("84%");
    expect(fmtPct(0)).toBe("0%");
  });
  it("dashes null", () => {
    expect(fmtPct(null)).toBe("—");
  });
});

describe("fmtDeltaPct", () => {
  it("uses up arrow for positive", () => {
    expect(fmtDeltaPct(12)).toBe("▲ 12%");
  });
  it("uses down arrow for negative", () => {
    expect(fmtDeltaPct(-7)).toBe("▼ 7%");
  });
  it("returns 0% for zero", () => {
    expect(fmtDeltaPct(0)).toBe("0%");
  });
  it("dashes null", () => {
    expect(fmtDeltaPct(null)).toBe("—");
  });
});

describe("fmtAgo", () => {
  // Delegates to date-fns formatDistanceToNow — these tests assert shape, not exact wording
  // (date-fns may evolve its phrasing).
  it("returns a relative phrase for a recent age", () => {
    expect(fmtAgo(2)).toMatch(/ago/);
  });
  it("returns 'never' for null", () => {
    expect(fmtAgo(null)).toBe("never");
  });
});
