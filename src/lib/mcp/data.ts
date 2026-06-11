/**
 * Data-assembly functions for the MCP server. Each function maps one MCP tool
 * to the Hub's existing read layer and returns a plain, JSON-serializable
 * object with both `*Cents` (integer) and `*Usd` (number) monetary fields.
 *
 * No auth is performed here — the route enforces the shared secret via
 * `withMcpAuth`. These functions never return decrypted API keys, password
 * hashes, or invite tokens.
 */

import { and, asc, desc, eq, gte, ilike, isNull, lte, ne, or, sql } from "drizzle-orm";
import { endOfMonth, format, parseISO, subMonths } from "date-fns";

import { db } from "@/lib/db";
import {
  accessTiers,
  aiTools,
  anthropicSyncStatus,
  anthropicUsageMetrics,
  anthropicWorkspaceCosts,
  anthropicWorkspaces,
  billedCosts,
  budgetPeriods,
  copilotBillingSnapshots,
  copilotUsageMetrics,
  githubConnections,
  invoices,
  licenseAssignments,
  syncEvents,
  users,
} from "@/lib/db/schema";
import { fetchProfileDataInternal } from "@/lib/profile-data";
import {
  loadDashboardKpis,
  loadSyncStatus,
  loadWorkspaceList,
} from "@/lib/anthropic/queries";
import { getBudgetWithCosts, fetchActualByPeriod } from "@/actions/budget";
import { getBudgetReportData } from "@/actions/reports";
import { buildBudgetForecast } from "@/lib/forecast";
import { LOCK_USER_ID } from "@/lib/anthropic-sync";
import { getCurrentMonth, formatUtcDateOnly } from "@/lib/utils";
import type { SyncSourceType } from "@/lib/sync/framework";
import { usd } from "@/lib/mcp/format";

/** Inclusive YYYY-MM-DD start/end of a YYYY-MM month. */
function monthRange(month: string): { start: string; end: string } {
  const start = `${month}-01`;
  return { start, end: format(endOfMonth(parseISO(start)), "yyyy-MM-dd") };
}

/** Escape ILIKE wildcards in user-supplied search terms. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  return Math.min(Math.max(limit ?? fallback, 1), max);
}

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

export async function listAiToolsData(options: {
  /**
   * License utilization (active counts, caps, utilization %) mirrors the
   * admin-only column on the /tools page — viewer-role callers get the
   * catalog without it, and the aggregate query is skipped entirely (039).
   */
  includeUtilization: boolean;
}) {
  const [tools, tiers, assignmentCounts] = await Promise.all([
    db
      .select({
        id: aiTools.id,
        name: aiTools.name,
        vendor: aiTools.vendor,
        status: aiTools.status,
        maxLicenses: aiTools.maxLicenses,
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
    options.includeUtilization
      ? db
          .select({
            toolId: licenseAssignments.toolId,
            count: sql<number>`count(*)::int`,
          })
          .from(licenseAssignments)
          .where(eq(licenseAssignments.status, "active"))
          .groupBy(licenseAssignments.toolId)
      : Promise.resolve([]),
  ]);

  const tiersByTool = new Map<number, typeof tiers>();
  for (const tier of tiers) {
    const list = tiersByTool.get(tier.toolId) ?? [];
    list.push(tier);
    tiersByTool.set(tier.toolId, list);
  }
  const countByTool = new Map(
    assignmentCounts.map((c) => [c.toolId, Number(c.count)]),
  );

  return {
    tools: tools.map((tool) => {
      const base = {
        id: tool.id,
        name: tool.name,
        vendor: tool.vendor,
        status: tool.status,
        tiers: (tiersByTool.get(tool.id) ?? []).map((tier) => ({
          id: tier.id,
          name: tier.name,
          ...usd("monthlyCost", tier.monthlyCostCents),
        })),
      };
      if (!options.includeUtilization) return base;
      const activeAssignments = countByTool.get(tool.id) ?? 0;
      return {
        ...base,
        activeAssignments,
        maxLicenses: tool.maxLicenses,
        licenseUtilizationPct:
          tool.maxLicenses && tool.maxLicenses > 0
            ? Math.round((activeAssignments / tool.maxLicenses) * 100)
            : null,
      };
    }),
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
    // Help the caller recover from a near-miss (assistants rarely have the
    // exact address) by suggesting candidates that share the local part.
    const localPart = email.split("@")[0] ?? email;
    const candidates = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(
        and(
          eq(users.isAgent, false),
          or(
            ilike(users.email, `%${escapeLike(localPart)}%`),
            ilike(users.name, `%${escapeLike(localPart.replace(/[._-]/g, " "))}%`),
          ),
        ),
      )
      .limit(5);
    const hint =
      candidates.length > 0
        ? ` Did you mean: ${candidates.map((c) => `${c.email} (${c.name})`).join(", ")}? Use find_users to search.`
        : ` Use find_users to search by name or partial email.`;
    throw new Error(`No user found with email: ${email}.${hint}`);
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
    const active = await db.query.annualBudgets.findFirst({
      where: (b, { eq: eqOp }) => eqOp(b.status, "active"),
      columns: { id: true },
    });
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

/**
 * Match getActiveConnection() in copilot-data.ts: a connection only counts as
 * active for Copilot when syncing is enabled — otherwise its metrics are
 * absent or stale and "connected: true" would be misleading.
 */
function findActiveCopilotConnection() {
  return db.query.githubConnections.findFirst({
    where: and(
      eq(githubConnections.status, "active"),
      eq(githubConnections.copilotSyncEnabled, true),
    ),
    columns: { id: true, orgLogin: true },
  });
}

/**
 * Default a Copilot date range to the last 28 days in UTC so the YYYY-MM-DD
 * day boundary is timezone-stable (matches the rest of the codebase, which
 * keys daily metrics on UTC dates).
 */
function defaultCopilotRange(since?: string, until?: string) {
  const today = new Date();
  return {
    sinceDate:
      since ?? formatUtcDateOnly(new Date(today.getTime() - 27 * 86_400_000)),
    untilDate: until ?? formatUtcDateOnly(today),
  };
}

export async function getCopilotUsageSummaryData(
  since?: string,
  until?: string,
) {
  const connection = await findActiveCopilotConnection();
  if (!connection) {
    return {
      connected: false as const,
      message: "No active GitHub connection with Copilot sync enabled",
    };
  }

  const { sinceDate, untilDate } = defaultCopilotRange(since, until);

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
  const cappedLimit = clampLimit(limit, 10, 50);

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

// ---------------------------------------------------------------------------
// find_users
// ---------------------------------------------------------------------------

export async function findUsersData(query: string, limit?: number) {
  const pattern = `%${escapeLike(query.trim())}%`;
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      circle: users.circle,
      profile: users.profile,
      discipline: users.discipline,
    })
    .from(users)
    .where(
      and(
        eq(users.isAgent, false),
        or(ilike(users.name, pattern), ilike(users.email, pattern)),
      ),
    )
    .orderBy(asc(users.name))
    .limit(clampLimit(limit, 10, 25));

  return { query, matches: rows };
}

// ---------------------------------------------------------------------------
// list_claude_users
// ---------------------------------------------------------------------------

export async function listClaudeUsersData(month?: string, limit?: number) {
  const targetMonth = month ?? getCurrentMonth();
  const { start, end } = monthRange(targetMonth);

  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      circle: users.circle,
      status: users.status,
      costCents: sql<string>`coalesce(sum(${anthropicUsageMetrics.computedCostCents}), 0)`,
      totalTokens: sql<string>`coalesce(sum(${anthropicUsageMetrics.uncachedInputTokens} + ${anthropicUsageMetrics.cacheReadInputTokens} + ${anthropicUsageMetrics.cacheCreationInputTokens} + ${anthropicUsageMetrics.outputTokens}), 0)`,
      modelsUsed: sql<string>`count(distinct ${anthropicUsageMetrics.model})`,
      lastActive: sql<string | null>`max(${anthropicUsageMetrics.date})`,
      hasUnresolvedPricing: sql<boolean>`bool_or(not ${anthropicUsageMetrics.pricingResolved})`,
    })
    .from(anthropicUsageMetrics)
    .innerJoin(users, eq(users.id, anthropicUsageMetrics.userId))
    .where(
      and(
        gte(anthropicUsageMetrics.date, start),
        lte(anthropicUsageMetrics.date, end),
        // Exclude the sync-lock sentinel row, matching _getUserList in
        // src/actions/anthropic-users.ts.
        ne(users.id, LOCK_USER_ID),
      ),
    )
    .groupBy(users.id, users.name, users.email, users.circle, users.status)
    .orderBy(desc(sql`sum(${anthropicUsageMetrics.computedCostCents})`))
    .limit(clampLimit(limit, 25, 100));

  const userRows = rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    email: r.email,
    circle: r.circle,
    status: r.status,
    ...usd("cost", Number(r.costCents)),
    totalTokens: Number(r.totalTokens),
    modelsUsed: Number(r.modelsUsed),
    lastActive: r.lastActive,
    hasUnresolvedPricing: Boolean(r.hasUnresolvedPricing),
  }));

  return {
    month: targetMonth,
    note: "Users with Claude API usage in the month, ordered by spend (descending).",
    userCount: userRows.length,
    ...usd("listedTotal", userRows.reduce((s, u) => s + (u.costCents ?? 0), 0)),
    users: userRows,
  };
}

// ---------------------------------------------------------------------------
// get_claude_cost_dashboard
// ---------------------------------------------------------------------------

export async function getClaudeCostDashboardData(month?: string) {
  const targetMonth = month ?? getCurrentMonth();
  const { start, end } = monthRange(targetMonth);

  const priorMonth = format(subMonths(parseISO(start), 1), "yyyy-MM");
  const { start: priorStart, end: priorEnd } = monthRange(priorMonth);
  const twelveMonthsAgoStart = format(subMonths(parseISO(start), 12), "yyyy-MM-dd");

  const workspaceName = sql<string | null>`${anthropicWorkspaces.name}`;
  const workspaceJoin = sql`${anthropicWorkspaces.workspaceId} IS NOT DISTINCT FROM ${anthropicWorkspaceCosts.workspaceId}`;
  const monthExpr = sql<string>`to_char(${anthropicWorkspaceCosts.date}, 'YYYY-MM')`;

  const [dailyTotals, workspaceTotals, monthlySeries] = await Promise.all([
    db
      .select({
        date: anthropicWorkspaceCosts.date,
        costCents: sql<string>`sum(${anthropicWorkspaceCosts.costCents})`,
      })
      .from(anthropicWorkspaceCosts)
      .where(
        and(
          gte(anthropicWorkspaceCosts.date, start),
          lte(anthropicWorkspaceCosts.date, end),
        ),
      )
      .groupBy(anthropicWorkspaceCosts.date)
      .orderBy(asc(anthropicWorkspaceCosts.date)),
    db
      .select({
        workspaceId: anthropicWorkspaceCosts.workspaceId,
        workspaceName,
        currentCents: sql<string>`coalesce(sum(${anthropicWorkspaceCosts.costCents}) filter (where ${anthropicWorkspaceCosts.date} between ${start} and ${end}), 0)`,
        priorCents: sql<string>`coalesce(sum(${anthropicWorkspaceCosts.costCents}) filter (where ${anthropicWorkspaceCosts.date} between ${priorStart} and ${priorEnd}), 0)`,
      })
      .from(anthropicWorkspaceCosts)
      .leftJoin(anthropicWorkspaces, workspaceJoin)
      .where(
        and(
          gte(anthropicWorkspaceCosts.date, priorStart),
          lte(anthropicWorkspaceCosts.date, end),
        ),
      )
      .groupBy(anthropicWorkspaceCosts.workspaceId, anthropicWorkspaces.name),
    db
      .select({
        month: monthExpr,
        costCents: sql<string>`sum(${anthropicWorkspaceCosts.costCents})`,
      })
      .from(anthropicWorkspaceCosts)
      .where(gte(anthropicWorkspaceCosts.date, twelveMonthsAgoStart))
      .groupBy(monthExpr)
      .orderBy(monthExpr),
  ]);

  const workspaces = workspaceTotals
    .map((w) => {
      const current = Number(w.currentCents);
      const prior = Number(w.priorCents);
      return {
        workspaceId: w.workspaceId,
        // Capitalization matches the admin dashboard (anthropic-global.ts).
        name: w.workspaceName ?? "Default Workspace",
        ...usd("currentMonth", current),
        ...usd("priorMonth", prior),
        ...usd("delta", current - prior),
        deltaPct: prior > 0 ? Math.round(((current - prior) / prior) * 100) : null,
      };
    })
    .sort((a, b) => (b.currentMonthCents ?? 0) - (a.currentMonthCents ?? 0));

  const monthTotal = dailyTotals.reduce((s, d) => s + Number(d.costCents), 0);

  return {
    month: targetMonth,
    priorMonth,
    ...usd("monthTotal", monthTotal),
    dailyTotals: dailyTotals.map((d) => ({
      date: d.date,
      ...usd("cost", Number(d.costCents)),
    })),
    workspaces,
    last12Months: monthlySeries.map((row) => ({
      month: row.month,
      ...usd("cost", Number(row.costCents)),
    })),
  };
}

// ---------------------------------------------------------------------------
// get_budget_report
// ---------------------------------------------------------------------------

export async function getBudgetReportToolData() {
  const report = await getBudgetReportData();
  if (report.kind === "empty") {
    throw new Error("No active budget configured");
  }

  return {
    fiscalYear: report.budget.fiscalYear,
    ...usd("budgetTotal", report.budget.totalAmountCents),
    periods: report.periodsWithActual.map((p) => ({
      label: p.periodLabel,
      startDate: p.startDate,
      endDate: p.endDate,
      ...usd("planned", p.plannedAmountCents),
      ...usd("billed", p.billedTotalCents),
      ...usd("running", p.runningCostCents),
      ...usd("actual", p.actualCents),
    })),
    forecast: {
      status: report.forecast.status,
      ...usd("actualSpendToDate", report.forecast.actualSpendToDateCents),
      ...usd("projectedAnnualTotal", report.forecast.projectedAnnualTotalCents),
      ...usd("budgetCeiling", report.forecast.budgetCeilingCents),
    },
    perTool: report.perTool.map((t) => ({
      toolName: t.toolName,
      isAnthropicApi: t.isAnthropicApi,
      ...usd("ytdSpent", t.ytdSpentCents),
      ...usd("currentMonthly", t.currentMonthlyCents),
      ...usd("projectedEoy", t.projectedEoyCents),
    })),
    pastMonth: report.pastMonth
      ? {
          periodLabel: report.pastMonth.periodLabel,
          ...usd("planned", report.pastMonth.plannedCents),
          ...usd("actual", report.pastMonth.actualCents),
          ...usd("variance", report.pastMonth.varianceCents),
          variancePct: report.pastMonth.variancePct,
          drivers: report.pastMonth.drivers.map((d) => ({
            toolName: d.toolName,
            ...usd("prior", d.priorCents),
            ...usd("past", d.pastCents),
            ...usd("delta", d.deltaCents),
            deltaPct: d.deltaPct,
          })),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// list_license_assignments
// ---------------------------------------------------------------------------

export async function listLicenseAssignmentsData(filters: {
  email?: string;
  toolName?: string;
  status?: "active" | "inactive";
  limit?: number;
}) {
  const status = filters.status ?? "active";
  const conditions = [
    filters.email ? ilike(users.email, escapeLike(filters.email)) : undefined,
    filters.toolName
      ? ilike(aiTools.name, `%${escapeLike(filters.toolName)}%`)
      : undefined,
    eq(licenseAssignments.status, status),
  ].filter((c) => c !== undefined);

  const rows = await db
    .select({
      id: licenseAssignments.id,
      userName: users.name,
      userEmail: users.email,
      toolName: aiTools.name,
      tierName: accessTiers.name,
      status: licenseAssignments.status,
      costAtAssignmentCents: licenseAssignments.costAtAssignmentCents,
      assignedAt: licenseAssignments.assignedAt,
      revokedAt: licenseAssignments.revokedAt,
      workspace: licenseAssignments.workspace,
      source: licenseAssignments.source,
    })
    .from(licenseAssignments)
    .innerJoin(users, eq(users.id, licenseAssignments.userId))
    .innerJoin(aiTools, eq(aiTools.id, licenseAssignments.toolId))
    .leftJoin(accessTiers, eq(accessTiers.id, licenseAssignments.tierId))
    .where(and(...conditions))
    .orderBy(desc(licenseAssignments.assignedAt))
    .limit(clampLimit(filters.limit, 100, 500));

  return {
    filters: {
      email: filters.email ?? null,
      toolName: filters.toolName ?? null,
      status,
    },
    count: rows.length,
    ...usd("monthlyTotal", rows.reduce((s, r) => s + r.costAtAssignmentCents, 0)),
    assignments: rows.map((r) => ({
      id: r.id,
      user: { name: r.userName, email: r.userEmail },
      toolName: r.toolName,
      tierName: r.tierName,
      status: r.status,
      ...usd("monthlyCost", r.costAtAssignmentCents),
      assignedAt: r.assignedAt?.toISOString() ?? null,
      revokedAt: r.revokedAt?.toISOString() ?? null,
      workspace: r.workspace,
      source: r.source,
    })),
  };
}

// ---------------------------------------------------------------------------
// list_invoices
// ---------------------------------------------------------------------------

export async function listInvoicesData(filters: {
  month?: string;
  vendor?: string;
  linked?: boolean;
  limit?: number;
}) {
  const range = filters.month ? monthRange(filters.month) : null;
  const conditions = [
    range ? gte(invoices.invoiceDate, range.start) : undefined,
    range ? lte(invoices.invoiceDate, range.end) : undefined,
    filters.vendor
      ? ilike(invoices.vendor, `%${escapeLike(filters.vendor)}%`)
      : undefined,
    filters.linked === true
      ? sql`${invoices.linkedBilledCostId} IS NOT NULL`
      : undefined,
    filters.linked === false ? isNull(invoices.linkedBilledCostId) : undefined,
  ].filter((c) => c !== undefined);

  const rows = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      amountCents: invoices.amountCents,
      vendor: invoices.vendor,
      filteredOut: invoices.filteredOut,
      linkedBilledCostId: invoices.linkedBilledCostId,
      periodLabel: budgetPeriods.periodLabel,
      createdAt: invoices.createdAt,
    })
    .from(invoices)
    .leftJoin(billedCosts, eq(billedCosts.id, invoices.linkedBilledCostId))
    .leftJoin(budgetPeriods, eq(budgetPeriods.id, billedCosts.periodId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(invoices.invoiceDate))
    .limit(clampLimit(filters.limit, 50, 200));

  return {
    filters: {
      month: filters.month ?? null,
      vendor: filters.vendor ?? null,
      linked: filters.linked ?? null,
    },
    count: rows.length,
    ...usd("listedTotal", rows.reduce((s, r) => s + r.amountCents, 0)),
    invoices: rows.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      invoiceDate: r.invoiceDate,
      ...usd("amount", r.amountCents),
      vendor: r.vendor,
      linkedToPeriod: r.periodLabel,
      isLinked: r.linkedBilledCostId !== null,
      filteredOut: r.filteredOut,
      uploadedAt: r.createdAt?.toISOString() ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// get_copilot_analytics
// ---------------------------------------------------------------------------

interface BreakdownAccumulator {
  suggestions: number;
  acceptances: number;
}

function accumulateBreakdown(
  map: Map<string, BreakdownAccumulator>,
  breakdown: unknown,
  nameKeys: string[],
): void {
  if (!Array.isArray(breakdown)) return;
  for (const entry of breakdown) {
    const item = entry as Record<string, unknown>;
    const nameKey = nameKeys.find((k) => item[k] != null);
    const name = String(nameKey ? item[nameKey] : "unknown");
    const acc = map.get(name) ?? { suggestions: 0, acceptances: 0 };
    acc.suggestions += Number(item.suggestions ?? item.totalSuggestions ?? 0);
    acc.acceptances += Number(item.acceptances ?? item.totalAcceptances ?? 0);
    map.set(name, acc);
  }
}

function topBreakdown(map: Map<string, BreakdownAccumulator>, label: string) {
  return Array.from(map.entries())
    .map(([name, data]) => ({
      [label]: name,
      suggestions: data.suggestions,
      acceptances: data.acceptances,
      acceptanceRatePct:
        data.suggestions > 0
          ? Math.round((data.acceptances / data.suggestions) * 100)
          : null,
    }))
    .sort((a, b) => b.suggestions - a.suggestions)
    .slice(0, 10);
}

export async function getCopilotAnalyticsData(since?: string, until?: string) {
  const connection = await findActiveCopilotConnection();
  if (!connection) {
    return {
      connected: false as const,
      message: "No active GitHub connection with Copilot sync enabled",
    };
  }

  const { sinceDate, untilDate } = defaultCopilotRange(since, until);

  const rows = await db
    .select({
      date: copilotUsageMetrics.date,
      totalActiveUsers: copilotUsageMetrics.totalActiveUsers,
      totalEngagedUsers: copilotUsageMetrics.totalEngagedUsers,
      totalSuggestions: copilotUsageMetrics.totalSuggestions,
      totalAcceptances: copilotUsageMetrics.totalAcceptances,
      totalChatTurns: copilotUsageMetrics.totalChatTurns,
      languageBreakdown: copilotUsageMetrics.languageBreakdown,
      editorBreakdown: copilotUsageMetrics.editorBreakdown,
    })
    .from(copilotUsageMetrics)
    .where(
      and(
        eq(copilotUsageMetrics.connectionId, connection.id),
        gte(copilotUsageMetrics.date, sinceDate),
        lte(copilotUsageMetrics.date, untilDate),
      ),
    )
    .orderBy(asc(copilotUsageMetrics.date));

  const byLanguage = new Map<string, BreakdownAccumulator>();
  const byEditor = new Map<string, BreakdownAccumulator>();
  for (const row of rows) {
    accumulateBreakdown(byLanguage, row.languageBreakdown, ["language", "name"]);
    accumulateBreakdown(byEditor, row.editorBreakdown, ["editor", "name"]);
  }

  return {
    connected: true as const,
    org: connection.orgLogin,
    dateRange: { since: sinceDate, until: untilDate },
    daily: rows.map((r) => ({
      date: r.date,
      activeUsers: r.totalActiveUsers,
      engagedUsers: r.totalEngagedUsers,
      suggestions: r.totalSuggestions,
      acceptances: r.totalAcceptances,
      chatTurns: r.totalChatTurns,
    })),
    topLanguages: topBreakdown(byLanguage, "language"),
    topEditors: topBreakdown(byEditor, "editor"),
  };
}
