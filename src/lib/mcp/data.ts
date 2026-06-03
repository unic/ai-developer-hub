/**
 * Data-assembly functions for the MCP server. Each function maps one MCP tool
 * to the Hub's existing read layer and returns a plain, JSON-serializable
 * object with both `*Cents` (integer) and `*Usd` (number) monetary fields.
 *
 * No auth is performed here — the route enforces the shared secret via
 * `withMcpAuth`. These functions never return decrypted API keys, password
 * hashes, or invite tokens.
 */

import { format, subDays } from "date-fns";
import { and, desc, eq, gte, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  accessTiers,
  aiTools,
  anthropicSyncStatus,
  copilotBillingSnapshots,
  copilotUsageMetrics,
  githubConnections,
  syncEvents,
  users,
} from "@/lib/db/schema";
import { fetchProfileDataInternal } from "@/lib/profile-data";
import {
  loadDashboardKpis,
  loadSyncStatus,
  loadWorkspaceList,
} from "@/lib/anthropic/queries";
import {
  getActiveBudget,
  getBudgetWithCosts,
  fetchActualByPeriod,
} from "@/actions/budget";
import { buildBudgetForecast } from "@/lib/forecast";
import { getCurrentMonth } from "@/lib/utils";
import type { SyncSourceType } from "@/lib/sync/framework";
import { usd } from "@/lib/mcp/format";

/** Shape a calibrated "today" spend estimate (or null) for an MCP response. */
function formatTodayEstimate(
  estimate: { cents: number; confident: boolean; asOfIso: string } | null,
) {
  if (!estimate) return null;
  return {
    ...usd("estimated", estimate.cents),
    confident: estimate.confident,
    asOf: estimate.asOfIso,
  };
}

// ---------------------------------------------------------------------------
// list_ai_tools
// ---------------------------------------------------------------------------

export async function listAiToolsData() {
  const [tools, tiers] = await Promise.all([
    db
      .select({
        id: aiTools.id,
        name: aiTools.name,
        vendor: aiTools.vendor,
        status: aiTools.status,
      })
      .from(aiTools)
      .where(eq(aiTools.status, "active")),
    db
      .select({
        id: accessTiers.id,
        toolId: accessTiers.toolId,
        name: accessTiers.name,
        monthlyCostCents: accessTiers.monthlyCostCents,
        isActive: accessTiers.isActive,
      })
      .from(accessTiers)
      .where(eq(accessTiers.isActive, true)),
  ]);

  const tiersByTool = new Map<number, typeof tiers>();
  for (const tier of tiers) {
    const list = tiersByTool.get(tier.toolId) ?? [];
    list.push(tier);
    tiersByTool.set(tier.toolId, list);
  }

  return {
    tools: tools.map((tool) => ({
      ...tool,
      tiers: (tiersByTool.get(tool.id) ?? []).map((tier) => ({
        id: tier.id,
        name: tier.name,
        ...usd("monthlyCost", tier.monthlyCostCents),
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// get_user_cost_profile
// ---------------------------------------------------------------------------

export async function getUserCostProfileData(email: string, month?: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true },
  });
  if (!user) {
    throw new Error(`No user found with email: ${email}`);
  }

  const [profile, syncRows] = await Promise.all([
    fetchProfileDataInternal(user.id, month),
    db
      .select({ lastSyncCompletedAt: anthropicSyncStatus.lastSyncCompletedAt })
      .from(anthropicSyncStatus)
      .where(eq(anthropicSyncStatus.userId, user.id))
      .limit(1),
  ]);

  const cost = profile.costData;
  return {
    user: {
      name: profile.user.name,
      email: profile.user.email,
      role: profile.user.role,
      circle: profile.user.circle,
      profile: profile.user.profile,
      discipline: profile.user.discipline,
    },
    assignments: profile.assignments.map((a) => ({
      id: a.id,
      toolName: a.toolName,
      tierName: a.tierName,
      status: a.status,
      assignedAt: a.assignedAt?.toISOString() ?? null,
    })),
    costData: {
      month: month ?? getCurrentMonth(),
      available: cost.available,
      error: cost.error ?? null,
      ...usd("monthlyTotal", cost.monthlyTotalCents),
      latestDataDate: cost.latestDataDate,
      hasUnresolvedPricing: cost.hasUnresolvedPricing,
      lastSyncAt: syncRows[0]?.lastSyncCompletedAt?.toISOString() ?? null,
      dailyBreakdown: cost.dailyBreakdown.map((day) => ({
        date: day.date,
        ...usd("total", day.totalCents),
        models: day.models.map((m) => ({
          model: m.model,
          ...usd("cost", m.costCents),
          inputTokens: m.inputTokens,
          outputTokens: m.outputTokens,
        })),
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// get_claude_spend_summary
// ---------------------------------------------------------------------------

export async function getClaudeSpendSummaryData(month?: string) {
  const targetMonth = month ?? getCurrentMonth();
  const kpis = await loadDashboardKpis(targetMonth);

  return {
    month: targetMonth,
    ...usd("total", kpis.totalCents),
    ...usd("priorMonth", kpis.priorMonthCents),
    ...usd("momDelta", kpis.momDeltaCents),
    momDeltaPct: kpis.momDeltaPct,
    ...usd("projectedMonthEnd", kpis.projectedMonthEndCents),
    workspacesOverEightyCount: kpis.workspacesOverEightyCount,
    workspacesWithLimitCount: kpis.workspacesWithLimitCount,
    topOverWorkspaceName: kpis.topOverWorkspaceName,
    topOverWorkspaceUtilizationPct: kpis.topOverWorkspaceUtilizationPct,
    todayEstimate: formatTodayEstimate(kpis.todayEstimate),
  };
}

// ---------------------------------------------------------------------------
// list_claude_workspaces
// ---------------------------------------------------------------------------

export async function listClaudeWorkspacesData() {
  const list = await loadWorkspaceList();
  return {
    workspaces: list.map((w) => ({
      workspaceId: w.workspaceId,
      name: w.name,
      isDefault: w.isDefault,
      ...usd("currentMonth", w.currentMonthCents),
      ...usd("limit", w.limitCents),
      utilizationPct: w.utilizationPct,
      displayColor: w.displayColor,
      todayEstimate: formatTodayEstimate(w.todayEstimate),
    })),
  };
}

// ---------------------------------------------------------------------------
// get_budget_status
// ---------------------------------------------------------------------------

export async function getBudgetStatusData(fiscalYear?: number) {
  let budgetId: number;
  if (fiscalYear !== undefined) {
    const row = await db.query.annualBudgets.findFirst({
      where: (b, { eq: eqOp }) => eqOp(b.fiscalYear, fiscalYear),
      columns: { id: true },
    });
    if (!row) throw new Error(`No budget found for fiscal year ${fiscalYear}`);
    budgetId = row.id;
  } else {
    const active = await getActiveBudget();
    if (!active) throw new Error("No active budget configured");
    budgetId = active.id;
  }

  const budget = await getBudgetWithCosts(budgetId);
  if (!budget) throw new Error("Budget not found");

  const today = new Date();
  const actualByPeriod = await fetchActualByPeriod(budget, today);
  const forecast = buildBudgetForecast(budget, actualByPeriod, today);

  return {
    fiscalYear: budget.fiscalYear,
    status: budget.status,
    periodType: budget.periodType,
    ...usd("totalAmount", budget.totalAmountCents),
    periods: budget.periods.map((p) => ({
      label: p.periodLabel,
      startDate: p.startDate,
      endDate: p.endDate,
      ...usd("planned", p.plannedAmountCents),
      ...usd("billed", p.billedTotalCents),
      ...usd("expected", p.expectedSpendCents),
      ...usd("actual", actualByPeriod.get(p.id) ?? p.billedTotalCents),
    })),
    forecast: {
      status: forecast.status,
      ...usd("actualSpendToDate", forecast.actualSpendToDateCents),
      ...usd("projectedAnnualTotal", forecast.projectedAnnualTotalCents),
      ...usd("budgetCeiling", forecast.budgetCeilingCents),
      insufficientData: forecast.insufficientData ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// get_copilot_usage_summary
// ---------------------------------------------------------------------------

export async function getCopilotUsageSummaryData(
  since?: string,
  until?: string,
) {
  const connection = await db.query.githubConnections.findFirst({
    where: eq(githubConnections.status, "active"),
    columns: { id: true, orgLogin: true },
  });
  if (!connection) {
    return {
      connected: false as const,
      message: "No active GitHub connection",
    };
  }

  const today = new Date();
  const untilDate = until ?? format(today, "yyyy-MM-dd");
  const sinceDate = since ?? format(subDays(today, 27), "yyyy-MM-dd");

  const [rows, billing] = await Promise.all([
    db
      .select({
        totalActiveUsers: copilotUsageMetrics.totalActiveUsers,
        totalEngagedUsers: copilotUsageMetrics.totalEngagedUsers,
        totalSuggestions: copilotUsageMetrics.totalSuggestions,
        totalAcceptances: copilotUsageMetrics.totalAcceptances,
        totalLinesSuggested: copilotUsageMetrics.totalLinesSuggested,
        totalLinesAccepted: copilotUsageMetrics.totalLinesAccepted,
        totalChatTurns: copilotUsageMetrics.totalChatTurns,
      })
      .from(copilotUsageMetrics)
      .where(
        and(
          eq(copilotUsageMetrics.connectionId, connection.id),
          gte(copilotUsageMetrics.date, sinceDate),
          lte(copilotUsageMetrics.date, untilDate),
        ),
      ),
    db.query.copilotBillingSnapshots.findFirst({
      where: eq(copilotBillingSnapshots.connectionId, connection.id),
      orderBy: (b, { desc: descOp }) => [descOp(b.billingMonth)],
    }),
  ]);

  const sum = (key: keyof (typeof rows)[number]) =>
    rows.reduce((acc, r) => acc + (r[key] ?? 0), 0);
  const peak = (key: keyof (typeof rows)[number]) =>
    rows.reduce((acc, r) => Math.max(acc, r[key] ?? 0), 0);

  const totalSuggestions = sum("totalSuggestions");
  const totalAcceptances = sum("totalAcceptances");

  return {
    connected: true as const,
    org: connection.orgLogin,
    dateRange: { since: sinceDate, until: untilDate },
    latestBilling: billing
      ? {
          billingMonth: billing.billingMonth,
          planType: billing.planType,
          totalSeats: billing.totalSeats,
          activeSeats: billing.activeSeats,
          ...usd("seatCost", billing.seatCostCents),
          ...usd("totalCost", billing.totalCostCents),
        }
      : null,
    usage: {
      daysWithData: rows.length,
      totalSuggestions,
      totalAcceptances,
      acceptanceRatePct:
        totalSuggestions > 0
          ? Math.round((totalAcceptances / totalSuggestions) * 100)
          : null,
      totalLinesSuggested: sum("totalLinesSuggested"),
      totalLinesAccepted: sum("totalLinesAccepted"),
      totalChatTurns: sum("totalChatTurns"),
      peakActiveUsers: peak("totalActiveUsers"),
      peakEngagedUsers: peak("totalEngagedUsers"),
    },
  };
}

// ---------------------------------------------------------------------------
// list_recent_sync_events
// ---------------------------------------------------------------------------

export async function listRecentSyncEventsData(
  sourceType?: SyncSourceType,
  limit?: number,
) {
  const cappedLimit = Math.min(Math.max(limit ?? 10, 1), 50);

  const [rows, freshness] = await Promise.all([
    db
      .select({
        id: syncEvents.id,
        sourceType: syncEvents.sourceType,
        outcome: syncEvents.outcome,
        startedAt: syncEvents.startedAt,
        completedAt: syncEvents.completedAt,
        createdCount: syncEvents.createdCount,
        updatedCount: syncEvents.updatedCount,
        skippedCount: syncEvents.skippedCount,
        errorCount: syncEvents.errorCount,
        errorMessage: syncEvents.errorMessage,
      })
      .from(syncEvents)
      .where(sourceType ? eq(syncEvents.sourceType, sourceType) : undefined)
      .orderBy(desc(syncEvents.startedAt))
      .limit(cappedLimit),
    loadSyncStatus(),
  ]);

  return {
    claudeSpendFreshness: {
      lastSyncedAt: freshness.lastSyncedAt?.toISOString() ?? null,
      ageMinutes: freshness.ageMinutes,
      isStale: freshness.isStale,
    },
    events: rows.map((e) => ({
      id: e.id,
      sourceType: e.sourceType,
      outcome: e.outcome,
      startedAt: e.startedAt?.toISOString() ?? null,
      completedAt: e.completedAt?.toISOString() ?? null,
      createdCount: e.createdCount,
      updatedCount: e.updatedCount,
      skippedCount: e.skippedCount,
      errorCount: e.errorCount,
      errorMessage: e.errorMessage,
    })),
  };
}
