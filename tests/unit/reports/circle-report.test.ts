import { describe, it, expect } from "vitest";
import { normalizeCircle } from "@/lib/utils";
import { buildCircleReport } from "@/lib/reports/circle-report";

describe("normalizeCircle", () => {
  it("returns null for null", () => expect(normalizeCircle(null)).toBeNull());
  it("returns null for undefined", () => expect(normalizeCircle(undefined)).toBeNull());
  it("returns null for empty string", () => expect(normalizeCircle("")).toBeNull());
  it("returns null for whitespace-only string", () => expect(normalizeCircle("  ")).toBeNull());
  it("returns null for 'n/a' (lowercase)", () => expect(normalizeCircle("n/a")).toBeNull());
  it("returns null for 'N/A' (uppercase)", () => expect(normalizeCircle("N/A")).toBeNull());
  it("returns null for ' n/a ' (trimmed)", () => expect(normalizeCircle(" n/a ")).toBeNull());
  it("returns null for 'none'", () => expect(normalizeCircle("none")).toBeNull());
  it("returns null for 'None'", () => expect(normalizeCircle("None")).toBeNull());
  it("returns the trimmed value for a real circle name", () =>
    expect(normalizeCircle("Engineering")).toBe("Engineering"));
  it("trims whitespace from a real circle name", () =>
    expect(normalizeCircle("  Eng  ")).toBe("Eng"));
});

describe("buildCircleReport", () => {
  const assignments = [
    { user: { id: 1 }, costAtAssignmentCents: 1000 },
    { user: { id: 2 }, costAtAssignmentCents: 2000 },
    { user: { id: 3 }, costAtAssignmentCents: 500 },
    { user: { id: 4 }, costAtAssignmentCents: 800 },
  ];

  it("collapses null and empty-string circles into one unassigned bucket", () => {
    const users = [
      { id: 1, circle: null },
      { id: 2, circle: "" },
    ];
    const result = buildCircleReport(users, assignments);
    expect(result).toHaveLength(1);
    expect(result[0].circle).toBeNull();
    expect(result[0].userCount).toBe(2);
    expect(result[0].licenseCount).toBe(2);
    expect(result[0].totalMonthlyCost).toBe(3000);
  });

  it("collapses null, empty-string, and 'n/a' into one unassigned bucket", () => {
    const users = [
      { id: 1, circle: null },
      { id: 2, circle: "" },
      { id: 3, circle: "n/a" },
    ];
    const result = buildCircleReport(users, assignments);
    expect(result).toHaveLength(1);
    expect(result[0].circle).toBeNull();
    expect(result[0].userCount).toBe(3);
  });

  it("collapses 'N/A', 'none', and whitespace into the unassigned bucket", () => {
    const users = [
      { id: 1, circle: "N/A" },
      { id: 2, circle: "none" },
      { id: 3, circle: "  " },
    ];
    const result = buildCircleReport(users, assignments);
    expect(result).toHaveLength(1);
    expect(result[0].circle).toBeNull();
  });

  it("keeps distinct real circle names as separate buckets", () => {
    const users = [
      { id: 1, circle: "Engineering" },
      { id: 2, circle: "Design" },
      { id: 3, circle: "Engineering" },
    ];
    const result = buildCircleReport(users, assignments);
    expect(result).toHaveLength(2);
    const eng = result.find((r) => r.circle === "Engineering");
    expect(eng?.userCount).toBe(2);
  });

  it("produces one unassigned bucket alongside real circles", () => {
    const users = [
      { id: 1, circle: null },
      { id: 2, circle: "n/a" },
      { id: 3, circle: "Engineering" },
      { id: 4, circle: "" },
    ];
    const result = buildCircleReport(users, assignments);
    expect(result).toHaveLength(2);
    const unassigned = result.find((r) => r.circle === null);
    expect(unassigned?.userCount).toBe(3);
    const eng = result.find((r) => r.circle === "Engineering");
    expect(eng?.userCount).toBe(1);
  });

  it("returns an empty array for empty user list", () => {
    const result = buildCircleReport([], assignments);
    expect(result).toHaveLength(0);
  });
});
