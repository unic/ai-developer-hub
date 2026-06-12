import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProfileData } from "@/types";

// ── Chainable db.select() mock ───────────────────────────────────────────────
// Each db.select() call consumes the next queued result; the chain is awaitable
// at any terminal (.where(), .limit(), ...) since every method returns itself.

interface SelectChain {
  from: () => SelectChain;
  where: () => SelectChain;
  innerJoin: () => SelectChain;
  leftJoin: () => SelectChain;
  groupBy: () => SelectChain;
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
      leftJoin: () => chain,
      groupBy: () => chain,
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
  getBudgetWithCosts: vi.fn(),
  fetchActualByPeriod: vi.fn(),
}));
vi.mock("@/actions/reports", () => ({
  getBudgetReportData: vi.fn(),
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
  findUsersData,
  listClaudeUsersData,
  getClaudeCostDashboardData,
  getBudgetReportToolData,
  listLicenseAssignmentsData,
  listInvoicesData,
  getCopilotAnalyticsData,
} from "@/lib/mcp/data";
import { fetchProfileDataInternal } from "@/lib/profile-data";
import {
  loadDashboardKpis,
  loadWorkspaceList,
  loadSyncStatus,
} from "@/lib/anthropic/queries";
import { getBudgetWithCosts, fetchActualByPeriod } from "@/actions/budget";
import { getBudgetReportData } from "@/actions/reports";

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
});

// ─────────────────────────────────────────────────────────────────────────────

describe("listAiToolsData", () => {
  it("groups active tiers under their tool and converts cost to USD", async () => {
    selectQueue.push(
      [
        {
          id: 1,
          name: "Claude API",
          vendor: "Anthropic",
          status: "active",
          maxLicenses: 20,
        },
      ],
      [
        {
          id: 10,
          toolId: 1,
          name: "Team",
          monthlyCostCents: 2500,
          isActive: true,
        },
      ],
      [{ toolId: 1, count: 15 }],
    );

    const result = await listAiToolsData({ includeUtilization: true });
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]).toMatchObject({
      id: 1,
      name: "Claude API",
      vendor: "Anthropic",
      activeAssignments: 15,
      maxLicenses: 20,
      licenseUtilizationPct: 75,
    });
    expect(result.tools[0].tiers[0]).toEqual({
      id: 10,
      name: "Team",
      monthlyCostCents: 2500,
      monthlyCostUsd: 25,
    });
  });

  it("returns a tool with no tiers and null utilization without maxLicenses", async () => {
    selectQueue.push(
      [
        {
          id: 2,
          name: "Cursor",
          vendor: "Anysphere",
          status: "active",
          maxLicenses: null,
        },
      ],
      [],
      [],
    );
    const result = await listAiToolsData({ includeUtilization: true });
    expect(result.tools[0].tiers).toEqual([]);
    expect(result.tools[0]).toMatchObject({
      activeAssignments: 0,
      licenseUtilizationPct: null,
    });
  });

  it("omits utilization fields (and skips the count query) for viewers", async () => {
    // Only two selects queued — the assignment-count aggregate must not run.
    selectQueue.push(
      [
        {
          id: 1,
          name: "Claude API",
          vendor: "Anthropic",
          status: "active",
          maxLicenses: 20,
        },
      ],
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
    const result = await listAiToolsData({ includeUtilization: false });
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]).not.toHaveProperty("activeAssignments");
    expect(result.tools[0]).not.toHaveProperty("maxLicenses");
    expect(result.tools[0]).not.toHaveProperty("licenseUtilizationPct");
    expect(result.tools[0].tiers[0]).toEqual({
      id: 10,
      name: "Team",
      monthlyCostCents: 2500,
      monthlyCostUsd: 25,
    });
    expect(selectQueue).toHaveLength(0);
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
    selectQueue.push([]); // no near-match candidates
    await expect(getUserCostProfileData("missing@example.com")).rejects.toThrow(
      /No user found/,
    );
  });

  it("suggests near-match candidates when the email misses", async () => {
    mockUsersFindFirst.mockResolvedValue(undefined);
    selectQueue.push([{ name: "Jane Doe", email: "jane.doe@example.com" }]);
    await expect(getUserCostProfileData("jane@example.com")).rejects.toThrow(
      /Did you mean: jane\.doe@example\.com \(Jane Doe\)/,
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
    mockAnnualFindFirst.mockResolvedValue(undefined);
    await expect(getBudgetStatusData()).rejects.toThrow(/No active budget/);
  });

  it("assembles per-period actuals and a forecast verdict", async () => {
    mockAnnualFindFirst.mockResolvedValue({ id: 5 });
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
    expect(mockAnnualFindFirst).toHaveBeenCalledTimes(1);
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

describe("findUsersData", () => {
  it("returns matching users with the original query echoed", async () => {
    selectQueue.push([
      {
        id: 1,
        name: "Jane Doe",
        email: "jane@example.com",
        role: "viewer",
        status: "active",
        circle: "Platform",
        profile: "boost",
        discipline: "developer",
      },
    ]);
    const result = await findUsersData("jane");
    expect(result.query).toBe("jane");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].email).toBe("jane@example.com");
  });
});

describe("listClaudeUsersData", () => {
  it("converts bigint-ish aggregates to numbers and sums the listed total", async () => {
    selectQueue.push([
      {
        userId: 1,
        name: "Jane",
        email: "jane@example.com",
        circle: "Platform",
        status: "active",
        costCents: "120000",
        totalTokens: "5000000",
        modelsUsed: "2",
        lastActive: "2026-05-20",
        hasUnresolvedPricing: false,
      },
      {
        userId: 2,
        name: "Bob",
        email: "bob@example.com",
        circle: null,
        status: "active",
        costCents: "30000",
        totalTokens: "900000",
        modelsUsed: "1",
        lastActive: "2026-05-18",
        hasUnresolvedPricing: true,
      },
    ]);

    const result = await listClaudeUsersData("2026-05");
    expect(result.month).toBe("2026-05");
    expect(result.userCount).toBe(2);
    expect(result.listedTotalCents).toBe(150000);
    expect(result.listedTotalUsd).toBe(1500);
    expect(result.users[0]).toMatchObject({
      email: "jane@example.com",
      costCents: 120000,
      costUsd: 1200,
      totalTokens: 5000000,
      modelsUsed: 2,
    });
    expect(result.users[1].hasUnresolvedPricing).toBe(true);
  });
});

describe("getClaudeCostDashboardData", () => {
  it("assembles daily totals, workspace deltas, and the 12-month series", async () => {
    selectQueue.push(
      // dailyTotals
      [
        { date: "2026-05-01", costCents: "10000" },
        { date: "2026-05-02", costCents: "20000" },
      ],
      // workspaceTotals (current + prior month)
      [
        {
          workspaceId: "ws_1",
          workspaceName: "Engineering",
          currentCents: "25000",
          priorCents: "20000",
        },
        {
          workspaceId: null,
          workspaceName: null,
          currentCents: "5000",
          priorCents: "0",
        },
      ],
      // monthlySeries
      [
        { month: "2026-04", costCents: "100000" },
        { month: "2026-05", costCents: "30000" },
      ],
    );

    const result = await getClaudeCostDashboardData("2026-05");
    expect(result.month).toBe("2026-05");
    expect(result.priorMonth).toBe("2026-04");
    expect(result.monthTotalCents).toBe(30000);
    expect(result.dailyTotals).toHaveLength(2);
    expect(result.workspaces[0]).toMatchObject({
      name: "Engineering",
      currentMonthCents: 25000,
      priorMonthCents: 20000,
      deltaCents: 5000,
      deltaPct: 25,
    });
    expect(result.workspaces[1]).toMatchObject({
      name: "Default Workspace",
      deltaPct: null,
    });
    expect(result.last12Months).toHaveLength(2);
  });
});

describe("getBudgetReportToolData", () => {
  it("throws when there is no active budget", async () => {
    vi.mocked(getBudgetReportData).mockResolvedValue({
      kind: "empty",
      reason: "no_active_budget",
    } as Awaited<ReturnType<typeof getBudgetReportData>>);
    await expect(getBudgetReportToolData()).rejects.toThrow(/No active budget/);
  });

  it("maps periods, forecast, per-tool rows, and past-month variance to USD", async () => {
    vi.mocked(getBudgetReportData).mockResolvedValue({
      kind: "ready",
      budget: { fiscalYear: 2026, totalAmountCents: 1200000 },
      periodsWithActual: [
        {
          periodLabel: "May 2026",
          startDate: "2026-05-01",
          endDate: "2026-05-31",
          plannedAmountCents: 100000,
          billedTotalCents: 60000,
          runningCostCents: 30000,
          actualCents: 90000,
        },
      ],
      forecast: {
        status: "on_track",
        actualSpendToDateCents: 90000,
        projectedAnnualTotalCents: 1100000,
        budgetCeilingCents: 1200000,
      },
      perTool: [
        {
          toolId: null,
          toolName: "Anthropic API",
          isAnthropicApi: true,
          ytdSpentCents: 50000,
          currentMonthlyCents: 30000,
          projectedEoyCents: 260000,
        },
      ],
      pastMonth: {
        periodLabel: "Apr 2026",
        plannedCents: 100000,
        actualCents: 110000,
        varianceCents: 10000,
        variancePct: 10,
        drivers: [
          {
            toolName: "Cursor",
            priorCents: 0,
            pastCents: 10000,
            deltaCents: 10000,
            deltaPct: null,
          },
        ],
      },
    } as unknown as Awaited<ReturnType<typeof getBudgetReportData>>);

    const result = await getBudgetReportToolData();
    expect(result.fiscalYear).toBe(2026);
    expect(result.budgetTotalUsd).toBe(12000);
    expect(result.periods[0]).toMatchObject({
      label: "May 2026",
      runningUsd: 300,
      actualUsd: 900,
    });
    expect(result.perTool[0]).toMatchObject({
      toolName: "Anthropic API",
      isAnthropicApi: true,
      ytdSpentUsd: 500,
    });
    expect(result.pastMonth).toMatchObject({
      periodLabel: "Apr 2026",
      varianceUsd: 100,
      variancePct: 10,
    });
    expect(result.pastMonth?.drivers[0]).toMatchObject({
      toolName: "Cursor",
      deltaUsd: 100,
    });
  });
});

describe("listLicenseAssignmentsData", () => {
  it("maps assignment rows with USD cost and echoes the filters", async () => {
    selectQueue.push([
      {
        id: 7,
        userName: "Jane",
        userEmail: "jane@example.com",
        toolName: "Cursor",
        tierName: "Pro",
        status: "active",
        costAtAssignmentCents: 2000,
        assignedAt: new Date("2026-01-15T00:00:00Z"),
        revokedAt: null,
        workspace: null,
        source: "manual",
      },
    ]);

    const result = await listLicenseAssignmentsData({ toolName: "Cursor" });
    expect(result.filters).toEqual({
      email: null,
      toolName: "Cursor",
      status: "active",
    });
    expect(result.count).toBe(1);
    expect(result.monthlyTotalUsd).toBe(20);
    expect(result.assignments[0]).toMatchObject({
      user: { name: "Jane", email: "jane@example.com" },
      toolName: "Cursor",
      tierName: "Pro",
      monthlyCostUsd: 20,
      assignedAt: "2026-01-15T00:00:00.000Z",
      revokedAt: null,
    });
  });
});

describe("listInvoicesData", () => {
  it("maps invoices with link status and excludes blob fields", async () => {
    selectQueue.push([
      {
        id: 3,
        invoiceNumber: "INV-100",
        invoiceDate: "2026-05-10",
        amountCents: 50000,
        vendor: "Anthropic",
        filteredOut: false,
        linkedBilledCostId: 9,
        periodLabel: "May 2026",
        createdAt: new Date("2026-05-11T08:00:00Z"),
      },
      {
        id: 4,
        invoiceNumber: "INV-101",
        invoiceDate: "2026-05-12",
        amountCents: 10000,
        vendor: "GitHub",
        filteredOut: false,
        linkedBilledCostId: null,
        periodLabel: null,
        createdAt: null,
      },
    ]);

    const result = await listInvoicesData({ month: "2026-05" });
    expect(result.count).toBe(2);
    expect(result.listedTotalUsd).toBe(600);
    expect(result.invoices[0]).toMatchObject({
      invoiceNumber: "INV-100",
      amountUsd: 500,
      isLinked: true,
      linkedToPeriod: "May 2026",
    });
    expect(result.invoices[1]).toMatchObject({
      isLinked: false,
      linkedToPeriod: null,
      uploadedAt: null,
    });
    expect(result.invoices[0]).not.toHaveProperty("blobUrl");
  });
});

describe("getCopilotAnalyticsData", () => {
  it("returns connected:false when no active connection", async () => {
    mockGithubFindFirst.mockResolvedValue(undefined);
    const result = await getCopilotAnalyticsData();
    expect(result).toMatchObject({ connected: false });
  });

  it("builds the daily series and aggregates language/editor breakdowns", async () => {
    mockGithubFindFirst.mockResolvedValue({ id: 3, orgLogin: "acme" });
    selectQueue.push([
      {
        date: "2026-05-01",
        totalActiveUsers: 10,
        totalEngagedUsers: 8,
        totalSuggestions: 100,
        totalAcceptances: 40,
        totalChatTurns: 12,
        languageBreakdown: [
          { language: "typescript", suggestions: 60, acceptances: 30 },
          { language: "python", suggestions: 40, acceptances: 10 },
        ],
        editorBreakdown: [{ editor: "vscode", suggestions: 100, acceptances: 40 }],
      },
      {
        date: "2026-05-02",
        totalActiveUsers: 12,
        totalEngagedUsers: 9,
        totalSuggestions: 50,
        totalAcceptances: 25,
        totalChatTurns: 5,
        languageBreakdown: [
          { language: "typescript", suggestions: 50, acceptances: 25 },
        ],
        editorBreakdown: null,
      },
    ]);

    const result = await getCopilotAnalyticsData("2026-05-01", "2026-05-02");
    if (!result.connected) throw new Error("expected connected");
    expect(result.daily).toHaveLength(2);
    expect(result.daily[1]).toMatchObject({
      date: "2026-05-02",
      activeUsers: 12,
      suggestions: 50,
    });
    expect(result.topLanguages[0]).toEqual({
      language: "typescript",
      suggestions: 110,
      acceptances: 55,
      acceptanceRatePct: 50,
    });
    expect(result.topEditors[0]).toMatchObject({
      editor: "vscode",
      suggestions: 100,
    });
  });
});
