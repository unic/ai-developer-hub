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
import { safeJsonResult } from "@/lib/mcp/format";
import {
  getBudgetStatusData,
  getClaudeSpendSummaryData,
  getCopilotUsageSummaryData,
  getUserCostProfileData,
  listAiToolsData,
  listClaudeWorkspacesData,
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

/** Minimal surface of McpServer.registerTool used here — eases fake-server tests. */
export type ToolRegistrar = Pick<McpServer, "registerTool">;

export function registerHubTools(server: ToolRegistrar): void {
  server.registerTool(
    "list_ai_tools",
    {
      title: "List AI tools",
      description:
        "List the active AI tools tracked by the Hub with their access tiers and monthly cost (cents and USD).",
      inputSchema: {},
    },
    () => safeJsonResult(() => listAiToolsData()),
  );

  server.registerTool(
    "get_user_cost_profile",
    {
      title: "Get user cost profile",
      description:
        "Get a user's active license assignments and their Claude API cost breakdown for a month. Looked up by exact email. Never returns API keys.",
      inputSchema: {
        email: z.string().email("Expected a valid email address"),
        month: monthSchema.optional(),
      },
    },
    ({ email, month }) =>
      safeJsonResult(() => getUserCostProfileData(email, month)),
  );

  server.registerTool(
    "get_claude_spend_summary",
    {
      title: "Get Claude spend summary",
      description:
        "Org-wide Claude (Anthropic) spend KPIs for a month: month-to-date total, month-over-month delta, month-end projection, workspaces over 80% of cap, and today's estimate. Defaults to the current month.",
      inputSchema: {
        month: monthSchema.optional(),
      },
    },
    ({ month }) => safeJsonResult(() => getClaudeSpendSummaryData(month)),
  );

  server.registerTool(
    "list_claude_workspaces",
    {
      title: "List Claude workspaces",
      description:
        "List Anthropic workspaces with current-month spend, monthly cap, utilization %, and today's estimate, ordered by cap-utilization severity.",
      inputSchema: {},
    },
    () => safeJsonResult(() => listClaudeWorkspacesData()),
  );

  server.registerTool(
    "get_budget_status",
    {
      title: "Get budget status",
      description:
        "Annual budget status: per-period planned/billed/expected/actual spend plus an OLS forecast of the annual total and on-track / at-risk verdict. Defaults to the active budget; pass a fiscal year to target a specific one.",
      inputSchema: {
        fiscalYear: z.number().int().min(2000).max(2100).optional(),
      },
    },
    ({ fiscalYear }) => safeJsonResult(() => getBudgetStatusData(fiscalYear)),
  );

  server.registerTool(
    "get_copilot_usage_summary",
    {
      title: "Get GitHub Copilot usage summary",
      description:
        "GitHub Copilot seat/billing snapshot and aggregated usage (suggestions, acceptance rate, lines, chat turns, peak users) over a date range. Defaults to the last 28 days.",
      inputSchema: {
        since: dateSchema.optional(),
        until: dateSchema.optional(),
      },
    },
    ({ since, until }) =>
      safeJsonResult(() => getCopilotUsageSummaryData(since, until)),
  );

  server.registerTool(
    "list_recent_sync_events",
    {
      title: "List recent sync events",
      description:
        "Recent data-pipeline sync events (with outcome and change counts) plus Claude-spend data freshness. Optionally filter by source type.",
      inputSchema: {
        sourceType: z.enum(syncSourceTypeEnum.enumValues).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    ({ sourceType, limit }) =>
      safeJsonResult(() => listRecentSyncEventsData(sourceType, limit)),
  );
}
