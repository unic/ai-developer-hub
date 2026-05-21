import { describe, it, expect } from "vitest";
import { summarizeErrors } from "@/lib/sync/error-message";

describe("summarizeErrors", () => {
  it("returns null for an empty array", () => {
    expect(summarizeErrors([])).toBe(null);
  });

  it("returns the joined string when within the cap", () => {
    const result = summarizeErrors(["one", "two", "three"]);
    expect(result).toBe("one; two; three");
  });

  it("truncates with a summary suffix when joined length exceeds the cap", () => {
    const big = "x".repeat(400);
    const errors = [big, big, big, big, big]; // 5 * 400 = 2000 chars joined
    const result = summarizeErrors(errors);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(1000);
    expect(result).toMatch(/\(\+\d+ more\)$/);
  });

  it("includes the count of dropped errors in the suffix", () => {
    const big = "y".repeat(500);
    const result = summarizeErrors([big, big, big, big]); // 4 × 500 = 2000 chars
    expect(result).toMatch(/\(\+[1-3] more\)$/);
  });

  it("emits the suffix even when the first message alone would exceed the cap", () => {
    const huge = "z".repeat(2000);
    const result = summarizeErrors([huge, "another", "third"]);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(1000);
    expect(result).toMatch(/\(\+3 more\)$/);
  });
});
