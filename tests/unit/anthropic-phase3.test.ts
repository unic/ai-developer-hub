import { describe, it, expect } from "vitest";

// Mirrors the URL "default" sentinel parser inside getWorkspaceDetail.
function parseWorkspaceParam(workspaceId: string): string | null {
  if (workspaceId === "default") return null;
  return workspaceId;
}

describe("workspace param parser", () => {
  it("translates 'default' URL sentinel to SQL NULL", () => {
    expect(parseWorkspaceParam("default")).toBeNull();
  });
  it("passes through real workspace ids unchanged", () => {
    expect(parseWorkspaceParam("wrkspc_01ABC")).toBe("wrkspc_01ABC");
  });
});

describe("Model breakdown percent math", () => {
  type Row = { modelName: string; costCents: number };
  function withPct(rows: Row[]) {
    const total = rows.reduce((s, r) => s + r.costCents, 0);
    return rows.map((r) => ({
      ...r,
      pctOfWorkspace: total === 0 ? 0 : Math.round((r.costCents / total) * 100),
    }));
  }
  it("sums to approximately 100 (rounding-tolerant)", () => {
    const rows = withPct([
      { modelName: "opus", costCents: 3020 },
      { modelName: "sonnet", costCents: 1642 },
      { modelName: "haiku", costCents: 587 },
    ]);
    const total = rows.reduce((s, r) => s + r.pctOfWorkspace, 0);
    expect(total).toBeGreaterThanOrEqual(99);
    expect(total).toBeLessThanOrEqual(101);
  });
  it("emits zero across the board when total cost is zero", () => {
    const rows = withPct([
      { modelName: "opus", costCents: 0 },
      { modelName: "sonnet", costCents: 0 },
    ]);
    expect(rows.every((r) => r.pctOfWorkspace === 0)).toBe(true);
  });
});

describe("Top-user tie ordering (mirrors ORDER BY cents DESC, secondary stable)", () => {
  type User = { userId: number; email: string; costCents: number };
  function rank(users: User[]) {
    return [...users].sort((a, b) => {
      if (b.costCents !== a.costCents) return b.costCents - a.costCents;
      return a.email.localeCompare(b.email);
    });
  }
  it("breaks ties deterministically (e.g. by email)", () => {
    const ranked = rank([
      { userId: 1, email: "bob@unic.com", costCents: 1_000 },
      { userId: 2, email: "alice@unic.com", costCents: 1_000 },
      { userId: 3, email: "carol@unic.com", costCents: 500 },
    ]);
    expect(ranked.map((r) => r.email)).toEqual([
      "alice@unic.com",
      "bob@unic.com",
      "carol@unic.com",
    ]);
  });
});
