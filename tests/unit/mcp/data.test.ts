import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProfileData } from "@/types";

// ── Chainable db.select() mock ───────────────────────────────────────────────
// Each db.select() call consumes the next queued result; the chain is awaitable
// at any terminal (.where(), .limit(), ...) since every method returns itself.

interface SelectChain {
  from: () => SelectChain;
  where: () => SelectChain;
  innerJoin: () => SelectChain;
  orderBy: () => SelectChain;
  limit: () => SelectChain;
  then: (
    resolve: (rows: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise<unknown>;
}

const {
  selectQueue,
  mockUsersFindFirst,
  mockAnnualFindFirst,
  mockGithubFindFirst,
  mockBillingFindFirst,
} = vi.hoisted(() => ({
  selectQueue: [] as unknown[],
  mockUsersFindFirst: vi.fn(),
  mockAnnualFindFirst: vi.fn(),
  mockGithubFindFirst: vi.fn(),
  mockBillingFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const selectChain = (rows: unknown): SelectChain => {
    const chain: SelectChain = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  };
  return {
    db: {
      select: () => selectChain(selectQueue.shift()),
      query: {
        users: { findFirst: mockUsersFindFirst },
        annualBudgets: { findFirst: mockAnnualFindFirst },
        githubConnections: { findFirst: mockGithubFindFirst },
        copilotBillingSnapshots: { findFirst: mockBillingFindFirst },
      },
    },
  };
});

vi.mock("@/lib/profile-data", () => ({
  fetchProfileDataInternal: vi.fn(),
}));
vi.mock("@/lib/anthropic/queries", () => ({
  loadDashboardKpis: vi.fn(),
  loadWorkspaceList: vi.fn(),
  loadSyncStatus: vi.fn(),
}));
vi.mock("@/actions/budget", () => ({
  getActiveBudget: vi.fn(),
  getBudgetWithCosts: vi.fn(),
  fetchActualByPeriod: vi.fn(),
}));

// ── Import after mocks ───────────────────────────────────────────────────────

import {
  listAiToolsData,
  getUserCostProfileData,
  getClaudeSpendSummaryData,
  listClaudeWorkspacesData,
  getBudgetStatusData,
  getCopilotUsageSummaryData,
  listRecentSyncEventsData,
} from "@/lib/mcp/data";
import { fetchProfileDataInternal } from "@/lib/profile-data";
import {
  loadDashboardKpis,
  loadWorkspaceList,
  loadSyncStatus,
} from "@/lib/anthropic/queries";
import {
  getActiveBudget,
  getBudgetWithCosts,
  fetchActualByPeriod,
} from "@/actions/budget";

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
});

// ─────────────────────────────────────────────────────────────────────────────

describe("listAiToolsData", () => {
  it("groups active tiers under their tool and converts cost to USD", async () => {
    selectQueue.push(
      [{ id: 1, name: "Claude API", vendor: "Anthropic", status: "active" }],
      [
        {
          id: 10,
          toolId: 1,
          name: "Team",
          monthlyCostCents: 2500,
          isActive: true,
        },
      ],
    );

    const result = await listAiToolsData();
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]).toMatchObject({
      id: 1,
      name: "Claude API",
      vendor: "Anthropic",
    });
    expect(result.tools[0].tiers[0]).toEqual({
      id: 10,
      name: "Team",
      monthlyCostCents: 2500,
      monthlyCostUsd: 25,
    });
  });

  it("returns a tool with no tiers when none are active", async () => {
    selectQueue.push(
      [{ id: 2, name: "Cursor", vendor: "Anysphere", status: "active" }],
      [],
    );
    const result = await listAiToolsData();
    expect(result.tools[0].tiers).toEqual([]);
  });
});

describe("getUserCostProfileData", () => {
  const profile: ProfileData = {
    user: {
      id: 1,
      name: "Jane",
      email: "jane@example.com",
      role: "viewer",
      circle: "Platform",
      profile: "boost",
      discipline: "developer",
    },
    assignments: [
      {
        id: 7,
        toolName: "Claude API",
        tierName: "Team",
        assignedAt: new Date("2026-01-15T00:00:00Z"),
        status: "active",
      },
    ],
    costData: {
      available: true,
      monthlyTotalCents: 4200,
      latestDataDate: "2026-05-20",
      hasUnresolvedPricing: false,
      dailyBreakdown: [
        {
          date: "2026-05-20",
          totalCents: 4200,
          models: [
            {
              model: "claude-opus-4",
              costCents: 4200,
              inputTokens: 1000,
              outputTokens: 500,
            },
          ],
        },
      ],
    },
  };

  it("throws when the user is not found", async () => {
    mockUsersFindFirst.mockResolvedValue(undefined);
    await expect(getUserCostProfileData("missing@example.com")).rejects.toThrow(
      /No user found/,
    );
  });

  it("shapes profile + cost data with USD and ISO sync timestamp", async () => {
    mockUsersFindFirst.mockResolvedValue({ id: 1 });
    vi.mocked(fetchProfileDataInternal).mockResolvedValue(profile);
    selectQueue.push([
      { lastSyncCompletedAt: new Date("2026-05-21T08:00:00Z") },
    ]);

    const result = await getUserCostProfileData("jane@example.com", "2026-05");
    expect(result.user.email).toBe("jane@example.com");
    expect(result.assignments[0].assignedAt).toBe("2026-01-15T00:00:00.000Z");
    expect(result.costData.monthlyTotalUsd).toBe(42);
    expect(result.costData.month).toBe("2026-05");
    expect(result.costData.lastSyncAt).toBe("2026-05-21T08:00:00.000Z");
    expect(result.costData.dailyBreakdown[0].models[0]).toEqual({
      model: "claude-opus-4",
      costCents: 4200,
      costUsd: 42,
      inputTokens: 1000,
      outputTokens: 500,
    });
  });

  it("tolerates a missing sync row", async () => {
    mockUsersFindFirst.mockResolvedValue({ id: 1 });
    vi.mocked(fetchProfileDataInternal).mockResolvedValue(profile);
    selectQueue.push([]);
    const result = await getUserCostProfileData("jane@example.com");
    expect(result.costData.lastSyncAt).toBeNull();
  });
});

describe("getClaudeSpendSummaryData", () => {
  it("converts KPI cents to USD and maps today estimate", async () => {
    vi.mocked(loadDashboardKpis).mockResolvedValue({
      totalCents: 100000,
      priorMonthCents: 80000,
      momDeltaCents: 20000,
      momDeltaPct: 25,
      projectedMonthEndCents: 150000,
      workspacesOverEightyCount: 1,
      workspacesWithLimitCount: 3,
      topOverWorkspaceName: "Engineering",
      topOverWorkspaceUtilizationPct: 92,
      todayEstimate: {
        cents: 5000,
        rawUserCents: 4800,
        calibration: 1.04,
        confident: true,
        asOfIso: "2026-05-21T08:00:00.000Z",
      },
    });

    const result = await getClaudeSpendSummaryData("2026-05");
    expect(result.month).toBe("2026-05");
    expect(result.totalUsd).toBe(1000);
    expect(result.momDeltaUsd).toBe(200);
    expect(result.todayEstimate).toEqual({
      estimatedCents: 5000,
      estimatedUsd: 50,
      confident: true,
      asOf: "2026-05-21T08:00:00.000Z",
    });
    expect(loadDashboardKpis).toHaveBeenCalledWith("2026-05");
  });

  it("passes null today estimate through", async () => {
    vi.mocked(loadDashboardKpis).mockResolvedValue({
      totalCents: 0,
      priorMonthCents: 0,
      momDeltaCents: 0,
      momDeltaPct: null,
      projectedMonthEndCents: 0,
      workspacesOverEightyCount: 0,
      workspacesWithLimitCount: 0,
      topOverWorkspaceName: null,
      topOverWorkspaceUtilizationPct: null,
      todayEstimate: null,
    });
    const result = await getClaudeSpendSummaryData("2026-05");
    expect(result.todayEstimate).toBeNull();
  });
});

describe("listClaudeWorkspacesData", () => {
  it("maps workspaces with USD cost, cap, and utilization", async () => {
    vi.mocked(loadWorkspaceList).mockResolvedValue([
      {
        workspaceId: "ws_1",
        name: "Engineering",
        isDefault: false,
        isArchived: false,
        currentMonthCents: 90000,
        limitCents: 100000,
        utilizationPct: 90,
        displayColor: "#abc",
        todayEstimate: null,
      },
    ]);
    const result = await listClaudeWorkspacesData();
    expect(result.workspaces[0]).toMatchObject({
      workspaceId: "ws_1",
      name: "Engineering",
      currentMonthCents: 90000,
      currentMonthUsd: 900,
      limitUsd: 1000,
      utilizationPct: 90,
    });
  });
});

describe("getBudgetStatusData", () => {
  const budget = {
    id: 5,
    fiscalYear: 2026,
    status: "active",
    periodType: "monthly",
    totalAmountCents: 1200000,
    periods: [
      {
        id: 50,
        periodLabel: "Jan 2026",
        periodIndex: 0,
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        plannedAmountCents: 100000,
        billedTotalCents: 95000,
        expectedSpendCents: 98000,
      },
    ],
  };

  it("throws when there is no active budget", async () => {
    vi.mocked(getActiveBudget).mockResolvedValue(undefined);
    await expect(getBudgetStatusData()).rejects.toThrow(/No active budget/);
  });

  it("assembles per-period actuals and a forecast verdict", async () => {
    vi.mocked(getActiveBudget).mockResolvedValue(
      budget as unknown as Awaited<ReturnType<typeof getActiveBudget>>,
    );
    vi.mocked(getBudgetWithCosts).mockResolvedValue(
      budget as unknown as Awaited<ReturnType<typeof getBudgetWithCosts>>,
    );
    vi.mocked(fetchActualByPeriod).mockResolvedValue(new Map([[50, 96000]]));

    const result = await getBudgetStatusData();
    expect(result.fiscalYear).toBe(2026);
    expect(result.totalAmountUsd).toBe(12000);
    expect(result.periods[0]).toMatchObject({
      label: "Jan 2026",
      plannedUsd: 1000,
      billedUsd: 950,
      actualCents: 96000,
      actualUsd: 960,
    });
    expect(["on_track", "at_risk"]).toContain(result.forecast.status);
  });

  it("looks up by fiscal year when provided", async () => {
    mockAnnualFindFirst.mockResolvedValue({ id: 5 });
    vi.mocked(getBudgetWithCosts).mockResolvedValue(
      budget as unknown as Awaited<ReturnType<typeof getBudgetWithCosts>>,
    );
    vi.mocked(fetchActualByPeriod).mockResolvedValue(new Map([[50, 96000]]));
    const result = await getBudgetStatusData(2026);
    expect(result.fiscalYear).toBe(2026);
    expect(getActiveBudget).not.toHaveBeenCalled();
  });
});

describe("getCopilotUsageSummaryData", () => {
  it("returns connected:false when no active GitHub connection", async () => {
    mockGithubFindFirst.mockResolvedValue(undefined);
    const result = await getCopilotUsageSummaryData();
    expect(result).toMatchObject({ connected: false });
  });

  it("aggregates usage rows and surfaces latest billing in USD", async () => {
    mockGithubFindFirst.mockResolvedValue({ id: 3, orgLogin: "acme" });
    selectQueue.push([
      {
        totalActiveUsers: 10,
        totalEngagedUsers: 8,
        totalSuggestions: 100,
        totalAcceptances: 40,
        totalLinesSuggested: 500,
        totalLinesAccepted: 200,
        totalChatTurns: 30,
      },
      {
        totalActiveUsers: 14,
        totalEngagedUsers: 12,
        totalSuggestions: 100,
        totalAcceptances: 60,
        totalLinesSuggested: 500,
        totalLinesAccepted: 300,
        totalChatTurns: null,
      },
    ]);
    mockBillingFindFirst.mockResolvedValue({
      billingMonth: "2026-05-01",
      planType: "business",
      totalSeats: 50,
      activeSeats: 44,
      seatCostCents: 1900,
      totalCostCents: 83600,
    });

    const result = await getCopilotUsageSummaryData("2026-05-01", "2026-05-31");
    expect(result).toMatchObject({ connected: true, org: "acme" });
    if (!result.connected) throw new Error("expected connected");
    expect(result.usage.daysWithData).toBe(2);
    expect(result.usage.totalSuggestions).toBe(200);
    expect(result.usage.totalAcceptances).toBe(100);
    expect(result.usage.acceptanceRatePct).toBe(50);
    expect(result.usage.totalChatTurns).toBe(30);
    expect(result.usage.peakActiveUsers).toBe(14);
    expect(result.latestBilling).toMatchObject({
      seatCostUsd: 19,
      totalCostUsd: 836,
    });
  });

  it("reports null acceptance rate when there are no suggestions", async () => {
    mockGithubFindFirst.mockResolvedValue({ id: 3, orgLogin: "acme" });
    selectQueue.push([]);
    mockBillingFindFirst.mockResolvedValue(undefined);
    const result = await getCopilotUsageSummaryData();
    if (!result.connected) throw new Error("expected connected");
    expect(result.usage.acceptanceRatePct).toBeNull();
    expect(result.latestBilling).toBeNull();
  });
});

describe("listRecentSyncEventsData", () => {
  it("maps events to ISO timestamps and includes freshness", async () => {
    selectQueue.push([
      {
        id: 1,
        sourceType: "anthropic_api_costs",
        outcome: "success",
        startedAt: new Date("2026-05-21T08:00:00Z"),
        completedAt: new Date("2026-05-21T08:01:00Z"),
        createdCount: 5,
        updatedCount: 2,
        skippedCount: 0,
        errorCount: 0,
        errorMessage: null,
      },
    ]);
    vi.mocked(loadSyncStatus).mockResolvedValue({
      lastSyncedAt: new Date("2026-05-21T08:01:00Z"),
      ageMinutes: 10,
      isStale: false,
    });

    const result = await listRecentSyncEventsData();
    expect(result.claudeSpendFreshness).toEqual({
      lastSyncedAt: "2026-05-21T08:01:00.000Z",
      ageMinutes: 10,
      isStale: false,
    });
    expect(result.events[0]).toMatchObject({
      id: 1,
      sourceType: "anthropic_api_costs",
      outcome: "success",
      startedAt: "2026-05-21T08:00:00.000Z",
      completedAt: "2026-05-21T08:01:00.000Z",
    });
  });
});
