/**
 * Registers the AI Developer Hub's read-only MCP tools on a given server.
 *
 * Kept decoupled from `mcp-handler`: `registerHubTools` accepts any object with
 * a `registerTool` method, so the wiring can be unit-tested against a fake
 * server without spinning up the transport. All handlers route through
 * `safeJsonResult` so a thrown error degrades to an `isError` result rather
 * than a raw protocol error.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { syncSourceTypeEnum } from "@/lib/db/schema";
import {
  adminOnly,
  callerFromAuthInfo,
  resolveSelfEmail,
  type HandlerAuthExtra,
} from "@/lib/mcp/access";
import { errorResult, safeJsonResult } from "@/lib/mcp/format";
import {
  findUsersData,
  getBudgetReportToolData,
  getBudgetStatusData,
  getClaudeCostDashboardData,
  getClaudeSpendSummaryData,
  getCopilotAnalyticsData,
  getCopilotUsageSummaryData,
  getUserCostProfileData,
  listAiToolsData,
  listClaudeUsersData,
  listClaudeWorkspacesData,
  listInvoicesData,
  listLicenseAssignmentsData,
  listRecentSyncEventsData,
} from "@/lib/mcp/data";

const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected month as YYYY-MM");
const dateSchema = z
  .string()
  .regex(
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
    "Expected YYYY-MM-DD",
  );

/**
 * Every Hub tool is read-only by design (spec 034); the annotation lets MCP
 * clients skip mutation-confirmation prompts.
 */
const READ_ONLY = { readOnlyHint: true } as const;

/**
 * Discovery-time hint appended to every admin-only tool description so
 * assistants holding a viewer token stop calling them speculatively (039).
 * Enforcement itself happens at invocation via `adminOnly`.
 */
const ADMIN_HINT = " Requires an admin-role token.";

/** Minimal surface of McpServer.registerTool used here — eases fake-server tests. */
export type ToolRegistrar = Pick<McpServer, "registerTool">;

export function registerHubTools(server: ToolRegistrar): void {
  server.registerTool(
    "list_ai_tools",
    {
      title: "List AI tools",
      description:
        "List the active AI tools tracked by the Hub with their access tiers and monthly cost (cents and USD). Admin-role tokens additionally get active license counts and license utilization.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    (_args: unknown, extra: HandlerAuthExtra) =>
      safeJsonResult(() =>
        listAiToolsData({
          includeUtilization:
            callerFromAuthInfo(extra?.authInfo).role === "admin",
        }),
      ),
  );

  server.registerTool(
    "get_user_cost_profile",
    {
      title: "Get user cost profile",
      description:
        "Get a user's active license assignments and their Claude API cost breakdown for a month. Defaults to the user bound to your token; admin-role tokens may query any email. Never returns API keys.",
      inputSchema: {
        email: z.string().email("Expected a valid email address").optional(),
        month: monthSchema.optional(),
      },
      annotations: READ_ONLY,
    },
    ({ email, month }, extra: HandlerAuthExtra) => {
      const resolved = resolveSelfEmail(
        callerFromAuthInfo(extra?.authInfo),
        email,
      );
      if (!resolved.ok) return Promise.resolve(errorResult(resolved.message));
      return safeJsonResult(() => getUserCostProfileData(resolved.email, month));
    },
  );

  server.registerTool(
    "get_claude_spend_summary",
    {
      title: "Get Claude spend summary",
      description:
        "Org-wide Claude (Anthropic) spend KPIs for a month: month-to-date total, month-over-month delta, month-end projection, workspaces over 80% of cap, and today's estimate. Defaults to the current month." +
        ADMIN_HINT,
      inputSchema: {
        month: monthSchema.optional(),
      },
      annotations: READ_ONLY,
    },
    adminOnly(({ month }) => getClaudeSpendSummaryData(month)),
  );

  server.registerTool(
    "list_claude_workspaces",
    {
      title: "List Claude workspaces",
      description:
        "List Anthropic workspaces with current-month spend, monthly cap, utilization %, and today's estimate, ordered by cap-utilization severity." +
        ADMIN_HINT,
      inputSchema: {},
      annotations: READ_ONLY,
    },
    adminOnly(() => listClaudeWorkspacesData()),
  );

  server.registerTool(
    "get_budget_status",
    {
      title: "Get budget status",
      description:
        "Annual budget status: per-period planned/billed/expected/actual spend plus an OLS forecast of the annual total and on-track / at-risk verdict. Defaults to the active budget; pass a fiscal year to target a specific one." +
        ADMIN_HINT,
      inputSchema: {
        fiscalYear: z.number().int().min(2000).max(2100).optional(),
      },
      annotations: READ_ONLY,
    },
    adminOnly(({ fiscalYear }) => getBudgetStatusData(fiscalYear)),
  );

  server.registerTool(
    "get_copilot_usage_summary",
    {
      title: "Get GitHub Copilot usage summary",
      description:
        "GitHub Copilot seat/billing snapshot and aggregated usage (suggestions, acceptance rate, lines, chat turns, peak users) over a date range. Defaults to the last 28 days." +
        ADMIN_HINT,
      inputSchema: {
        since: dateSchema.optional(),
        until: dateSchema.optional(),
      },
      annotations: READ_ONLY,
    },
    adminOnly(({ since, until }) => getCopilotUsageSummaryData(since, until)),
  );

  server.registerTool(
    "list_recent_sync_events",
    {
      title: "List recent sync events",
      description:
        "Recent data-pipeline sync events (with outcome and change counts) plus Claude-spend data freshness. Optionally filter by source type." +
        ADMIN_HINT,
      inputSchema: {
        sourceType: z.enum(syncSourceTypeEnum.enumValues).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: READ_ONLY,
    },
    adminOnly(({ sourceType, limit }) =>
      listRecentSyncEventsData(sourceType, limit),
    ),
  );

  server.registerTool(
    "find_users",
    {
      title: "Find users",
      description:
        "Search Hub users by partial name or email (case-insensitive). Use this to resolve a person to their exact email before calling get_user_cost_profile." +
        ADMIN_HINT,
      inputSchema: {
        query: z.string().min(2, "Query must be at least 2 characters"),
        limit: z.number().int().min(1).max(25).optional(),
      },
      annotations: READ_ONLY,
    },
    adminOnly(({ query, limit }) => findUsersData(query, limit)),
  );

  server.registerTool(
    "list_claude_users",
    {
      title: "List Claude users by spend",
      description:
        "Per-user Claude (Anthropic) API spend for a month, ordered by cost: total cost, tokens, distinct models, and last-active date per user. Defaults to the current month. Answers questions like 'who are the top Claude spenders'." +
        ADMIN_HINT,
      inputSchema: {
        month: monthSchema.optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: READ_ONLY,
    },
    adminOnly(({ month, limit }) => listClaudeUsersData(month, limit)),
  );

  server.registerTool(
    "get_claude_cost_dashboard",
    {
      title: "Get Claude cost dashboard",
      description:
        "Org-wide Claude cost dashboard for a month: daily spend series, per-workspace totals with month-over-month deltas, and a 12-month history. Defaults to the current month." +
        ADMIN_HINT,
      inputSchema: {
        month: monthSchema.optional(),
      },
      annotations: READ_ONLY,
    },
    adminOnly(({ month }) => getClaudeCostDashboardData(month)),
  );

  server.registerTool(
    "get_budget_report",
    {
      title: "Get budget report",
      description:
        "Detailed report on the active annual budget: per-period planned/billed/running/actual spend, forecast, per-tool YTD + projected end-of-year breakdown (including un-invoiced Anthropic API costs), and last completed period's variance drivers." +
        ADMIN_HINT,
      inputSchema: {},
      annotations: READ_ONLY,
    },
    adminOnly(() => getBudgetReportToolData()),
  );

  server.registerTool(
    "list_license_assignments",
    {
      title: "List license assignments",
      description:
        "The license register: who holds which AI-tool license at what monthly cost. Filter by user email (exact), tool name (partial), and status (default: active). Viewer-role tokens see only their own assignments.",
      inputSchema: {
        email: z.string().email().optional(),
        toolName: z.string().min(1).optional(),
        status: z.enum(["active", "inactive"]).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: READ_ONLY,
    },
    (filters, extra: HandlerAuthExtra) => {
      const caller = callerFromAuthInfo(extra?.authInfo);
      if (caller.role === "admin") {
        return safeJsonResult(() => listLicenseAssignmentsData(filters));
      }
      const resolved = resolveSelfEmail(caller, filters.email);
      if (!resolved.ok) return Promise.resolve(errorResult(resolved.message));
      return safeJsonResult(() =>
        listLicenseAssignmentsData({ ...filters, email: resolved.email }),
      );
    },
  );

  server.registerTool(
    "list_invoices",
    {
      title: "List invoices",
      description:
        "Uploaded invoices with amount, vendor, and budget-period link status. Filter by invoice month (YYYY-MM), vendor (partial), and linked (true = linked to a budget period, false = unlinked)." +
        ADMIN_HINT,
      inputSchema: {
        month: monthSchema.optional(),
        vendor: z.string().min(1).optional(),
        linked: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: READ_ONLY,
    },
    adminOnly((filters) => listInvoicesData(filters)),
  );

  server.registerTool(
    "get_copilot_analytics",
    {
      title: "Get GitHub Copilot analytics",
      description:
        "Daily GitHub Copilot usage series (active/engaged users, suggestions, acceptances, chat turns) plus top languages and editors over a date range. Defaults to the last 28 days." +
        ADMIN_HINT,
      inputSchema: {
        since: dateSchema.optional(),
        until: dateSchema.optional(),
      },
      annotations: READ_ONLY,
    },
    adminOnly(({ since, until }) => getCopilotAnalyticsData(since, until)),
  );
}
