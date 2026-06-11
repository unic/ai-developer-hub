import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpToolResult } from "@/lib/mcp/format";

vi.mock("@/lib/mcp/data", () => ({
  listAiToolsData: vi.fn(),
  getUserCostProfileData: vi.fn(),
  getClaudeSpendSummaryData: vi.fn(),
  listClaudeWorkspacesData: vi.fn(),
  getBudgetStatusData: vi.fn(),
  getCopilotUsageSummaryData: vi.fn(),
  listRecentSyncEventsData: vi.fn(),
  findUsersData: vi.fn(),
  listClaudeUsersData: vi.fn(),
  getClaudeCostDashboardData: vi.fn(),
  getBudgetReportToolData: vi.fn(),
  listLicenseAssignmentsData: vi.fn(),
  listInvoicesData: vi.fn(),
  getCopilotAnalyticsData: vi.fn(),
}));

import { registerHubTools, type ToolRegistrar } from "@/lib/mcp/tools";
import {
  listAiToolsData,
  getUserCostProfileData,
  getClaudeSpendSummaryData,
} from "@/lib/mcp/data";

type Handler = (args: Record<string, unknown>) => Promise<McpToolResult>;

function collectHandlers(): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const fakeServer = {
    registerTool: (name: string, _meta: unknown, handler: Handler) => {
      handlers.set(name, handler);
      return undefined;
    },
  };
  registerHubTools(fakeServer as unknown as ToolRegistrar);
  return handlers;
}

const EXPECTED_TOOLS = [
  "list_ai_tools",
  "get_user_cost_profile",
  "get_claude_spend_summary",
  "list_claude_workspaces",
  "get_budget_status",
  "get_copilot_usage_summary",
  "list_recent_sync_events",
  "find_users",
  "list_claude_users",
  "get_claude_cost_dashboard",
  "get_budget_report",
  "list_license_assignments",
  "list_invoices",
  "get_copilot_analytics",
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registerHubTools", () => {
  it("registers exactly the expected read-only tools", () => {
    const handlers = collectHandlers();
    expect([...handlers.keys()].sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("routes a successful call through jsonResult", async () => {
    vi.mocked(listAiToolsData).mockResolvedValue({ tools: [] });
    const handlers = collectHandlers();
    const result = await handlers.get("list_ai_tools")!({});
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ tools: [] });
  });

  it("forwards validated args to the data layer", async () => {
    vi.mocked(getUserCostProfileData).mockResolvedValue({
      user: {},
      assignments: [],
      costData: {},
    } as unknown as Awaited<ReturnType<typeof getUserCostProfileData>>);
    const handlers = collectHandlers();
    await handlers.get("get_user_cost_profile")!({
      email: "a@b.com",
      month: "2026-05",
    });
    expect(getUserCostProfileData).toHaveBeenCalledWith("a@b.com", "2026-05");
  });

  it("degrades a thrown error into an isError result", async () => {
    vi.mocked(getClaudeSpendSummaryData).mockRejectedValue(
      new Error("db down"),
    );
    const handlers = collectHandlers();
    const result = await handlers.get("get_claude_spend_summary")!({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: db down");
  });
});
