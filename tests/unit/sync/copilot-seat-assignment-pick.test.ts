import { describe, it, expect } from "vitest";
import { pickAssignmentPerUser } from "@/lib/copilot-sync";

type Row = {
  id: number;
  userId: number;
  status: "active" | "inactive";
  source: string | null;
};

const pick = (rows: Row[]) => pickAssignmentPerUser(rows);

describe("pickAssignmentPerUser", () => {
  it("prefers the active row over an older inactive copilot-sync row", () => {
    // The production failure: an inactive copilot-sync row (#102) next to an
    // active row from the licence-request workflow. Reactivating #102 broke
    // license_assignments_one_active_idx on every run.
    const rows: Row[] = [
      { id: 102, userId: 7, status: "inactive", source: "copilot-sync" },
      {
        id: 300,
        userId: 7,
        status: "active",
        source: "license-request-workflow",
      },
    ];
    expect(pick(rows).get(7)?.id).toBe(300);
  });

  it("prefers the active row regardless of order", () => {
    const rows: Row[] = [
      { id: 300, userId: 7, status: "active", source: "manual" },
      { id: 102, userId: 7, status: "inactive", source: "copilot-sync" },
    ];
    expect(pick(rows).get(7)?.id).toBe(300);
  });

  it("prefers copilot-sync among rows of the same status", () => {
    const rows: Row[] = [
      { id: 1, userId: 7, status: "inactive", source: "manual" },
      { id: 2, userId: 7, status: "inactive", source: "copilot-sync" },
      { id: 3, userId: 7, status: "inactive", source: "manual" },
    ];
    expect(pick(rows).get(7)?.id).toBe(2);
  });

  it("keeps one row per user", () => {
    const rows: Row[] = [
      { id: 1, userId: 1, status: "active", source: "copilot-sync" },
      { id: 2, userId: 2, status: "inactive", source: "manual" },
    ];
    const result = pick(rows);
    expect(result.size).toBe(2);
    expect(result.get(1)?.id).toBe(1);
    expect(result.get(2)?.id).toBe(2);
  });
});
