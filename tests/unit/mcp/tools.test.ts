import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
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
import { ADMIN_REQUIRED_MESSAGE, SELF_ONLY_MESSAGE } from "@/lib/mcp/access";
import * as data from "@/lib/mcp/data";
import {
  listAiToolsData,
  getUserCostProfileData,
  getClaudeSpendSummaryData,
  listLicenseAssignmentsData,
} from "@/lib/mcp/data";

type Handler = (
  args: Record<string, unknown>,
  extra?: { authInfo?: AuthInfo },
) => Promise<McpToolResult>;
type ToolMeta = {
  description?: string;
  annotations?: { readOnlyHint?: boolean };
};

function collectTools(): Map<string, { meta: ToolMeta; handler: Handler }> {
  const tools = new Map<string, { meta: ToolMeta; handler: Handler }>();
  const fakeServer = {
    registerTool: (name: string, meta: ToolMeta, handler: Handler) => {
      tools.set(name, { meta, handler });
      return undefined;
    },
  };
  registerHubTools(fakeServer as unknown as ToolRegistrar);
  return tools;
}

function collectHandlers(): Map<string, Handler> {
  return new Map(
    [...collectTools()].map(([name, { handler }]) => [name, handler]),
  );
}

function authInfo(extra?: Record<string, unknown>): { authInfo: AuthInfo } {
  return { authInfo: { token: "t", clientId: "c", scopes: ["mcp:read"], extra } };
}

const ADMIN = authInfo({
  userId: 1,
  email: "admin@unic.com",
  name: "Admin",
  role: "admin",
});
const VIEWER = authInfo({
  userId: 2,
  email: "viewer@unic.com",
  name: "Viewer",
  role: "viewer",
});
/** Shared-secret credential: admin-equivalent, no bound user. */
const SECRET = authInfo({ role: "admin" });

/**
 * The access-class partition (contract: specs/039-mcp-role-scoping). The
 * exhaustiveness test below fails when a new tool is registered without being
 * classified here — the guard against a 15th tool silently shipping org-wide
 * data to viewers.
 */
const ADMIN_ONLY_TOOLS: Record<string, { dataFn: keyof typeof data }> = {
  get_claude_spend_summary: { dataFn: "getClaudeSpendSummaryData" },
  list_claude_workspaces: { dataFn: "listClaudeWorkspacesData" },
  list_claude_users: { dataFn: "listClaudeUsersData" },
  get_claude_cost_dashboard: { dataFn: "getClaudeCostDashboardData" },
  get_budget_status: { dataFn: "getBudgetStatusData" },
  get_budget_report: { dataFn: "getBudgetReportToolData" },
  get_copilot_usage_summary: { dataFn: "getCopilotUsageSummaryData" },
  get_copilot_analytics: { dataFn: "getCopilotAnalyticsData" },
  list_invoices: { dataFn: "listInvoicesData" },
  list_recent_sync_events: { dataFn: "listRecentSyncEventsData" },
  find_users: { dataFn: "findUsersData" },
};
const SELF_SCOPED_TOOLS = ["get_user_cost_profile", "list_license_assignments"];
const VIEWER_SAFE_TOOLS = ["list_ai_tools"];

const EXPECTED_TOOLS = [
  ...Object.keys(ADMIN_ONLY_TOOLS),
  ...SELF_SCOPED_TOOLS,
  ...VIEWER_SAFE_TOOLS,
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registerHubTools", () => {
  it("registers exactly the expected read-only tools", () => {
    const handlers = collectHandlers();
    expect([...handlers.keys()].sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("classifies every registered tool into exactly one access class", () => {
    // EXPECTED_TOOLS is the union of the three class lists; equality with the
    // registered set (asserted above) plus uniqueness here proves the partition.
    expect(new Set(EXPECTED_TOOLS).size).toBe(EXPECTED_TOOLS.length);
  });

  it("marks every tool with the readOnlyHint annotation", () => {
    for (const [name, { meta }] of collectTools()) {
      expect(meta.annotations?.readOnlyHint, `${name} missing readOnlyHint`).toBe(
        true,
      );
    }
  });

  it("routes a successful call through jsonResult", async () => {
    vi.mocked(listAiToolsData).mockResolvedValue({ tools: [] });
    const handlers = collectHandlers();
    const result = await handlers.get("list_ai_tools")!({}, ADMIN);
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
    await handlers.get("get_user_cost_profile")!(
      { email: "a@b.com", month: "2026-05" },
      ADMIN,
    );
    expect(getUserCostProfileData).toHaveBeenCalledWith("a@b.com", "2026-05");
  });

  it("degrades a thrown error into an isError result", async () => {
    vi.mocked(getClaudeSpendSummaryData).mockRejectedValue(
      new Error("db down"),
    );
    const handlers = collectHandlers();
    const result = await handlers.get("get_claude_spend_summary")!({}, ADMIN);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: db down");
  });
});

describe("admin-only tools (039 role scoping)", () => {
  it.each(Object.keys(ADMIN_ONLY_TOOLS))(
    "%s denies a viewer with the shared message and no data call",
    async (toolName) => {
      const handlers = collectHandlers();
      const result = await handlers.get(toolName)!({}, VIEWER);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe(`Error: ${ADMIN_REQUIRED_MESSAGE}`);
      expect(
        vi.mocked(data[ADMIN_ONLY_TOOLS[toolName].dataFn]),
      ).not.toHaveBeenCalled();
    },
  );

  it.each(Object.keys(ADMIN_ONLY_TOOLS))(
    "%s serves an admin token (no regression)",
    async (toolName) => {
      const fn = vi.mocked(data[ADMIN_ONLY_TOOLS[toolName].dataFn]);
      fn.mockResolvedValue({} as never);
      const handlers = collectHandlers();
      const result = await handlers.get(toolName)!({}, ADMIN);
      expect(result.isError).toBeUndefined();
      expect(fn).toHaveBeenCalledTimes(1);
    },
  );

  it.each(Object.keys(ADMIN_ONLY_TOOLS))(
    "%s serves the shared secret (admin-equivalent)",
    async (toolName) => {
      const fn = vi.mocked(data[ADMIN_ONLY_TOOLS[toolName].dataFn]);
      fn.mockResolvedValue({} as never);
      const handlers = collectHandlers();
      const result = await handlers.get(toolName)!({}, SECRET);
      expect(result.isError).toBeUndefined();
      expect(fn).toHaveBeenCalledTimes(1);
    },
  );

  it("denies when authInfo is missing entirely (fail-closed)", async () => {
    const handlers = collectHandlers();
    const result = await handlers.get("get_budget_status")!({});
    expect(result.isError).toBe(true);
    expect(vi.mocked(data.getBudgetStatusData)).not.toHaveBeenCalled();
  });

  it("documents the admin requirement in every description", () => {
    const tools = collectTools();
    for (const name of Object.keys(ADMIN_ONLY_TOOLS)) {
      expect(
        tools.get(name)!.meta.description,
        `${name} missing admin hint`,
      ).toContain("Requires an admin-role token.");
    }
  });
});

describe("get_user_cost_profile self-scoping", () => {
  beforeEach(() => {
    vi.mocked(getUserCostProfileData).mockResolvedValue(
      {} as Awaited<ReturnType<typeof getUserCostProfileData>>,
    );
  });

  it("viewer: omitted email defaults to the token owner", async () => {
    const handlers = collectHandlers();
    const result = await handlers.get("get_user_cost_profile")!({}, VIEWER);
    expect(result.isError).toBeUndefined();
    expect(getUserCostProfileData).toHaveBeenCalledWith(
      "viewer@unic.com",
      undefined,
    );
  });

  it("viewer: own email accepted case-insensitively", async () => {
    const handlers = collectHandlers();
    await handlers.get("get_user_cost_profile")!(
      { email: " VIEWER@unic.com " },
      VIEWER,
    );
    expect(getUserCostProfileData).toHaveBeenCalledWith(
      "viewer@unic.com",
      undefined,
    );
  });

  it("viewer: a foreign email is refused and no data is fetched", async () => {
    const handlers = collectHandlers();
    const result = await handlers.get("get_user_cost_profile")!(
      { email: "admin@unic.com" },
      VIEWER,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(`Error: ${SELF_ONLY_MESSAGE}`);
    expect(getUserCostProfileData).not.toHaveBeenCalled();
  });

  it("admin: any email is allowed", async () => {
    const handlers = collectHandlers();
    await handlers.get("get_user_cost_profile")!(
      { email: "viewer@unic.com", month: "2026-05" },
      ADMIN,
    );
    expect(getUserCostProfileData).toHaveBeenCalledWith(
      "viewer@unic.com",
      "2026-05",
    );
  });

  it("admin: omitted email defaults to own profile", async () => {
    const handlers = collectHandlers();
    await handlers.get("get_user_cost_profile")!({}, ADMIN);
    expect(getUserCostProfileData).toHaveBeenCalledWith(
      "admin@unic.com",
      undefined,
    );
  });

  it("shared secret: omitted email is a validation error (no bound identity)", async () => {
    const handlers = collectHandlers();
    const result = await handlers.get("get_user_cost_profile")!({}, SECRET);
    expect(result.isError).toBe(true);
    expect(getUserCostProfileData).not.toHaveBeenCalled();
  });

  it("shared secret: explicit email keeps working (034 compatibility)", async () => {
    const handlers = collectHandlers();
    await handlers.get("get_user_cost_profile")!(
      { email: "x@unic.com" },
      SECRET,
    );
    expect(getUserCostProfileData).toHaveBeenCalledWith("x@unic.com", undefined);
  });
});

describe("list_license_assignments self-scoping", () => {
  beforeEach(() => {
    vi.mocked(listLicenseAssignmentsData).mockResolvedValue(
      {} as Awaited<ReturnType<typeof listLicenseAssignmentsData>>,
    );
  });

  it("viewer: pinned to own email; other filters pass through", async () => {
    const handlers = collectHandlers();
    await handlers.get("list_license_assignments")!(
      { toolName: "Copilot", status: "active", limit: 5 },
      VIEWER,
    );
    expect(listLicenseAssignmentsData).toHaveBeenCalledWith({
      toolName: "Copilot",
      status: "active",
      limit: 5,
      email: "viewer@unic.com",
    });
  });

  it("viewer: a foreign email filter is refused", async () => {
    const handlers = collectHandlers();
    const result = await handlers.get("list_license_assignments")!(
      { email: "admin@unic.com" },
      VIEWER,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(`Error: ${SELF_ONLY_MESSAGE}`);
    expect(listLicenseAssignmentsData).not.toHaveBeenCalled();
  });

  it("admin: filters pass through unchanged, no email pinning", async () => {
    const handlers = collectHandlers();
    await handlers.get("list_license_assignments")!(
      { toolName: "Copilot" },
      ADMIN,
    );
    expect(listLicenseAssignmentsData).toHaveBeenCalledWith({
      toolName: "Copilot",
    });
  });

  it("shared secret: unfiltered org-wide listing still works", async () => {
    const handlers = collectHandlers();
    await handlers.get("list_license_assignments")!({}, SECRET);
    expect(listLicenseAssignmentsData).toHaveBeenCalledWith({});
  });
});

describe("list_ai_tools utilization stripping", () => {
  beforeEach(() => {
    vi.mocked(listAiToolsData).mockResolvedValue({ tools: [] });
  });

  it("viewer: catalog requested without utilization", async () => {
    const handlers = collectHandlers();
    const result = await handlers.get("list_ai_tools")!({}, VIEWER);
    expect(result.isError).toBeUndefined();
    expect(listAiToolsData).toHaveBeenCalledWith({ includeUtilization: false });
  });

  it("admin: full catalog with utilization", async () => {
    const handlers = collectHandlers();
    await handlers.get("list_ai_tools")!({}, ADMIN);
    expect(listAiToolsData).toHaveBeenCalledWith({ includeUtilization: true });
  });

  it("shared secret: full catalog with utilization", async () => {
    const handlers = collectHandlers();
    await handlers.get("list_ai_tools")!({}, SECRET);
    expect(listAiToolsData).toHaveBeenCalledWith({ includeUtilization: true });
  });
});
