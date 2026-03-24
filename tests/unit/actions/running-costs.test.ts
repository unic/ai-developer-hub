import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock transitive dependencies that require server-only modules
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/anthropic-sync", () => ({
  syncSingleUser: vi.fn(),
  anthropicToolFilter: "",
}));
vi.mock("@/lib/sync/sources/anthropic-usage", () => ({
  run: vi.fn(),
}));
vi.mock("@/lib/anthropic-pricing", () => ({
  resolveModelPricing: vi.fn(),
  computeCostCents: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      budgetPeriods: {
        findFirst: vi.fn(),
      },
    },
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn(),
  },
}));

import { getRunningCostsForPeriod } from "@/lib/budget-utils";
import { db } from "@/lib/db";

describe("getRunningCostsForPeriod", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when period not found", async () => {
    vi.mocked(db.query.budgetPeriods.findFirst).mockResolvedValue(undefined);
    const result = await getRunningCostsForPeriod(999);
    expect(result).toBeNull();
  });

  it("returns null when no workspace cost rows exist", async () => {
    vi.mocked(db.query.budgetPeriods.findFirst).mockResolvedValue({
      id: 1,
      budgetId: 1,
      periodLabel: "Jan 2026",
      periodIndex: 0,
      startDate: "2026-01-01",
      endDate: "2026-02-01",
      plannedAmountCents: 100000,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Mock the chained query returning empty
    const mockGroupBy = vi.fn().mockResolvedValue([]);
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: mockGroupBy,
          }),
        }),
      }),
    } as any);

    const result = await getRunningCostsForPeriod(1);
    expect(result).toBeNull();
  });

  it("returns correct sum with source field", async () => {
    vi.mocked(db.query.budgetPeriods.findFirst).mockResolvedValue({
      id: 1,
      budgetId: 1,
      periodLabel: "Jan 2026",
      periodIndex: 0,
      startDate: "2026-01-01",
      endDate: "2026-02-01",
      plannedAmountCents: 100000,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const mockGroupBy = vi.fn().mockResolvedValue([
      {
        workspaceId: "ws-1",
        name: "Production",
        costCents: 5000,
        lastUpdatedAt: "2026-01-15T10:00:00Z",
      },
    ]);
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: mockGroupBy,
          }),
        }),
      }),
    } as any);

    const result = await getRunningCostsForPeriod(1);
    expect(result).not.toBeNull();
    expect(result!.runningCostCents).toBe(5000);
    expect(result!.source).toBe("anthropic_workspace_costs");
    expect(result!.lastUpdatedAt).toBeTruthy();
    // Single workspace — no breakdown
    expect(result!.workspaceBreakdown).toBeUndefined();
  });

  it("includes breakdown when multiple workspaces", async () => {
    vi.mocked(db.query.budgetPeriods.findFirst).mockResolvedValue({
      id: 1,
      budgetId: 1,
      periodLabel: "Jan 2026",
      periodIndex: 0,
      startDate: "2026-01-01",
      endDate: "2026-02-01",
      plannedAmountCents: 100000,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const mockGroupBy = vi.fn().mockResolvedValue([
      { workspaceId: "ws-1", name: "Production", costCents: 3000, lastUpdatedAt: "2026-01-15T10:00:00Z" },
      { workspaceId: "ws-2", name: "Staging", costCents: 2000, lastUpdatedAt: "2026-01-14T10:00:00Z" },
    ]);
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: mockGroupBy,
          }),
        }),
      }),
    } as any);

    const result = await getRunningCostsForPeriod(1);
    expect(result).not.toBeNull();
    expect(result!.runningCostCents).toBe(5000);
    expect(result!.workspaceBreakdown).toHaveLength(2);
    expect(result!.workspaceBreakdown![0].name).toBe("Production");
    expect(result!.workspaceBreakdown![1].name).toBe("Staging");
  });
});
