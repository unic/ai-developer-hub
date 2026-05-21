import { describe, it, expect } from "vitest";
import { mapOutcomeToLegacyStatus } from "@/lib/sync/queries";

describe("mapOutcomeToLegacyStatus", () => {
  it("maps success → completed", () => {
    expect(mapOutcomeToLegacyStatus("success")).toBe("completed");
  });

  it("passes partial through unchanged", () => {
    expect(mapOutcomeToLegacyStatus("partial")).toBe("partial");
  });

  it("passes failed through unchanged", () => {
    expect(mapOutcomeToLegacyStatus("failed")).toBe("failed");
  });

  it("returns null for in_progress (filtered at the query layer)", () => {
    expect(mapOutcomeToLegacyStatus("in_progress")).toBe(null);
  });

  it("returns null for undefined", () => {
    expect(mapOutcomeToLegacyStatus(undefined)).toBe(null);
  });

  it("returns null for null", () => {
    expect(mapOutcomeToLegacyStatus(null)).toBe(null);
  });
});
