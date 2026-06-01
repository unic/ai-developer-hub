import { describe, it, expect } from "vitest";
import { buildMonthOptions } from "@/components/profile/month-picker";

describe("buildMonthOptions", () => {
  it("returns the months unchanged when the value is already present", () => {
    const months = ["2026-06", "2026-05", "2026-04"];
    expect(buildMonthOptions("2026-05", months)).toEqual([
      "2026-06",
      "2026-05",
      "2026-04",
    ]);
  });

  it("injects the current month at the head when it is the newest (1st-of-month case)", () => {
    // No rows for the current month yet — the value must still be selectable.
    const months = ["2026-05", "2026-04"];
    expect(buildMonthOptions("2026-06", months)).toEqual([
      "2026-06",
      "2026-05",
      "2026-04",
    ]);
  });

  it("falls back to a single option when no months are available", () => {
    expect(buildMonthOptions("2026-06", [])).toEqual(["2026-06"]);
  });

  it("inserts a past value in chronological position, not at the head", () => {
    const months = ["2026-06", "2026-05"];
    expect(buildMonthOptions("2026-01", months)).toEqual([
      "2026-06",
      "2026-05",
      "2026-01",
    ]);
  });

  it("inserts a future value at the head while preserving newest-first order", () => {
    const months = ["2026-06", "2026-05"];
    expect(buildMonthOptions("2099-01", months)).toEqual([
      "2099-01",
      "2026-06",
      "2026-05",
    ]);
  });

  it("does not duplicate a value already present but out of order", () => {
    const months = ["2026-04", "2026-06", "2026-05"];
    const result = buildMonthOptions("2026-06", months);
    expect(result).toEqual(["2026-06", "2026-05", "2026-04"]);
    expect(result.filter((m) => m === "2026-06")).toHaveLength(1);
  });
});
