import { describe, it, expect } from "vitest";
import {
  centsToUsd,
  usd,
  jsonResult,
  errorResult,
  safeJsonResult,
} from "@/lib/mcp/format";

describe("centsToUsd", () => {
  it("converts cents to a 2-decimal USD number", () => {
    expect(centsToUsd(1234)).toBe(12.34);
    expect(centsToUsd(0)).toBe(0);
    expect(centsToUsd(5)).toBe(0.05);
    expect(centsToUsd(100)).toBe(1);
  });

  it("rounds fractional cents before dividing", () => {
    expect(centsToUsd(1234.6)).toBe(12.35);
  });

  it("returns 0 for non-finite input", () => {
    expect(centsToUsd(NaN)).toBe(0);
    expect(centsToUsd(Infinity)).toBe(0);
  });
});

describe("usd", () => {
  it("emits a Cents and Usd sibling pair", () => {
    expect(usd("total", 1234)).toEqual({ totalCents: 1234, totalUsd: 12.34 });
  });

  it("emits nulls for null/undefined", () => {
    expect(usd("total", null)).toEqual({ totalCents: null, totalUsd: null });
    expect(usd("total", undefined)).toEqual({
      totalCents: null,
      totalUsd: null,
    });
  });

  it("treats 0 as a real value, not missing", () => {
    expect(usd("total", 0)).toEqual({ totalCents: 0, totalUsd: 0 });
  });
});

describe("jsonResult / errorResult", () => {
  it("wraps data as pretty JSON text content", () => {
    const result = jsonResult({ a: 1 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual({ a: 1 });
  });

  it("marks error results with isError and an Error: prefix", () => {
    const result = errorResult("boom");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: boom");
  });
});

describe("safeJsonResult", () => {
  it("serializes a successful result", async () => {
    const result = await safeJsonResult(async () => ({ ok: true }));
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ ok: true });
  });

  it("converts a thrown Error into an isError result", async () => {
    const result = await safeJsonResult(async () => {
      throw new Error("nope");
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: nope");
  });

  it("handles non-Error throws", async () => {
    const result = await safeJsonResult(async () => {
      throw "string failure";
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: Unknown error");
  });
});
