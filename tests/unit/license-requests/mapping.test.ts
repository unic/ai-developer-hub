import { describe, it, expect } from "vitest";
import {
  normalizeRole,
  normalizeProfile,
  pickMapping,
  type MappingRow,
} from "@/lib/license-requests/mapping";

describe("normalizeRole", () => {
  it("maps the Form's 'development' to the enum's 'developer'", () => {
    expect(normalizeRole("development")).toBe("developer");
  });
  it("passes conception and business through", () => {
    expect(normalizeRole("conception")).toBe("conception");
    expect(normalizeRole("business")).toBe("business");
  });
});

describe("normalizeProfile", () => {
  it("treats empty string as baseline", () => {
    expect(normalizeProfile("")).toBe("baseline");
  });
  it("treats undefined as baseline", () => {
    expect(normalizeProfile(undefined)).toBe("baseline");
  });
  it("passes maxed and indie through", () => {
    expect(normalizeProfile("maxed")).toBe("maxed");
    expect(normalizeProfile("indie")).toBe("indie");
  });
});

describe("pickMapping", () => {
  // Mirrors the seeded AI Tooling Guide rules.
  const rows: MappingRow[] = [
    { role: "developer", profile: "baseline", toolId: 1, defaultTierId: 1 },
    { role: "conception", profile: "baseline", toolId: 5, defaultTierId: 9 },
    { role: "business", profile: "baseline", toolId: 5, defaultTierId: 9 },
    { role: null, profile: "maxed", toolId: 3, defaultTierId: 5 },
    { role: null, profile: "indie", toolId: null, defaultTierId: null },
  ];

  it("resolves an exact (role, profile) row", () => {
    expect(pickMapping(rows, "developer", "baseline")?.toolId).toBe(1);
    expect(pickMapping(rows, "business", "baseline")?.toolId).toBe(5);
  });

  it("falls back to the any-role row for the profile", () => {
    expect(pickMapping(rows, "developer", "maxed")?.toolId).toBe(3);
    expect(pickMapping(rows, "business", "maxed")?.toolId).toBe(3);
  });

  it("prefers an exact row over the any-role row", () => {
    const withOverride: MappingRow[] = [
      ...rows,
      { role: "developer", profile: "maxed", toolId: 99, defaultTierId: null },
    ];
    expect(pickMapping(withOverride, "developer", "maxed")?.toolId).toBe(99);
    // Others still hit the any-role row.
    expect(pickMapping(withOverride, "business", "maxed")?.toolId).toBe(3);
  });

  it("returns the indie row with toolId null (needs decision)", () => {
    const m = pickMapping(rows, "conception", "indie");
    expect(m).not.toBeNull();
    expect(m?.toolId).toBeNull();
  });

  it("returns null when no row matches the profile", () => {
    expect(pickMapping([], "developer", "baseline")).toBeNull();
    expect(
      pickMapping(
        rows.filter((r) => r.profile !== "baseline"),
        "developer",
        "baseline",
      ),
    ).toBeNull();
  });
});
