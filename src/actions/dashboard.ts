"use server";

import { db } from "@/lib/db";
import {
  accessTiers,
  aiTools,
  anthropicSyncStatus,
  anthropicUsageMetrics,
  ingestionLog,
  licenseAssignments,
  users as usersTable,
} from "@/lib/db/schema";
import { and, desc, eq, gte, isNotNull, lte, or, sql, sum } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth-helpers";
import { getAssignments, getAssignmentSnapshotAt } from "@/actions/assignments";
import { getTools } from "@/actions/tools";
import { getUsers } from "@/actions/users";
import {
  getActiveBudget,
  getBilledCostsTimeSeries,
  getBudgetForecast,
  getBudgetWithCosts,
} from "@/actions/budget";
import { getCopilotOverview } from "@/actions/copilot-data";
import { getRunningCostsForPeriod } from "@/lib/budget-utils";
import { getDashboardKpis, getSyncStatus } from "@/actions/anthropic-global";
import { fetchProfileDataInternal } from "@/lib/profile-data";
import {
  classifyPeriod,
  computeSpendTrend,
} from "@/lib/reports/period-helpers";
import { formatCurrency, getLastMonthEnd } from "@/lib/utils";
import type {
  CostData,
  PeriodWithActual,
  ProfileData,
  ReportOverviewData,
  SparklinePoint,
  SyncStatus,
  ToolSummaryItem,
} from "@/types";

function isAnthropicTool(vendor: string, name: string): boolean {
  const v = vendor.toLowerCase();
  const n = name.toLowerCase();
  return v.includes("anthropic") || n.includes("claude");
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface DashboardActivityItem {
  id: string;
  kind: "ingestion" | "assignment_added" | "assignment_revoked";
  timestamp: string;
  title: string;
  detail: string | null;
  severity: "info" | "success" | "warn" | "danger";
}

export interface AdminSpendSeriesPoint {
  periodLabel: string;
  licensesCents: number;
  apiCents: number;
  isForecast: boolean;
}

export interface AdminThisMonthSnapshot {
  periodLabel: string | null;
  plannedCents: number;
  actualCents: number;
  billedCents: number;
  runningCents: number;
  variancePct: number | null;
}

export interface WorkspaceAlertSummary {
  topOverWorkspaceName: string | null;
  topOverWorkspaceUtilizationPct: number | null;
  workspacesOverEightyCount: number;
  workspacesWithLimitCount: number;
}

export interface AdminDashboardData {
  overview: ReportOverviewData;
  toolSummary: ToolSummaryItem[];
  expectedMonthlySparkline: SparklinePoint[];
  thisMonth: AdminThisMonthSnapshot;
  spendSeries: AdminSpendSeriesPoint[];
  copilot: {
    acceptanceRate: number | null;
    totalActiveUsers: number;
    trend: number[];
  } | null;
  workspaceAlert: WorkspaceAlertSummary;
  sync: SyncStatus;
  activity: DashboardActivityItem[];
  budgetCeilingCents: number;
  /** The originally approved ceiling — equal to budgetCeilingCents when not extended. */
  budgetOriginalCeilingCents: number;
  billedYtdCents: number;
}

// ---------------------------------------------------------------------------
// Admin dashboard data
// ---------------------------------------------------------------------------

export async function getAdminDashboardData(): Promise<AdminDashboardData | null> {
  const admin = await requireAdmin();
  if (!admin) return null;

  const lastMonthEnd = getLastMonthEnd();

  const [
    assignments,
    tools,
    userList,
    activeBudget,
    priorMonthSnapshot,
    sync,
    workspaceKpis,
    copilotResult,
    activity,
  ] = await Promise.all([
    getAssignments(),
    getTools(),
    getUsers(),
    getActiveBudget(),
    getAssignmentSnapshotAt(lastMonthEnd),
    getSyncStatus(),
    getDashboardKpis(),
    safeCopilotAcceptance(),
    getRecentDashboardActivity(8),
  ]);

  const [trendsData, forecastResult, budgetWithCosts] = activeBudget
    ? await Promise.all([
        getBilledCostsTimeSeries(activeBudget.id),
        getBudgetForecast(activeBudget.id),
        getBudgetWithCosts(activeBudget.id),
      ])
    : [[], null, null];

  const forecastData =
    forecastResult && "success" in forecastResult && forecastResult.success
      ? forecastResult.data
      : null;

  const activeAssignments = assignments.filter((a) => a.status === "active");

  const toolSummary: ToolSummaryItem[] = tools.map((tool) => {
    const toolAssignments = activeAssignments.filter(
      (a) => a.tool.id === tool.id
    );
    const totalCost = toolAssignments.reduce(
      (s, a) => s + a.costAtAssignmentCents,
      0
    );
    return {
      id: tool.id,
      name: tool.name,
      vendor: tool.vendor,
      activeUsers: toolAssignments.length,
      totalMonthlyCost: totalCost,
    };
  });

  const totalActiveUsers = userList.filter((u) => u.status === "active").length;
  const totalActiveTools = tools.filter((t) => t.status === "active").length;
  const totalMonthlySpend = activeAssignments.reduce(
    (s, a) => s + a.costAtAssignmentCents,
    0
  );
  const billedYtdCents = trendsData.reduce((s, p) => s + p.billedCents, 0);
  const budgetCeilingCents = activeBudget?.totalAmountCents ?? 0;
  const budgetOriginalCeilingCents = activeBudget?.originalAmountCents ?? 0;
  const budgetRemainingCents = budgetCeilingCents - billedYtdCents;
  const utilizationPct =
    budgetCeilingCents > 0 ? (billedYtdCents / budgetCeilingCents) * 100 : 0;

  const today = new Date();
  const completedTrend = (activeBudget?.periods ?? [])
    .filter((bp) => classifyPeriod(bp, today) === "past")
    .map((bp) => {
      const trend = trendsData.find((t) => t.month === bp.periodLabel);
      return {
        label: bp.periodLabel,
        billedCents: trend?.billedCents ?? 0,
        plannedCents: trend?.plannedCents ?? 0,
      };
    })
    .filter((p) => p.billedCents > 0);
  const { spendTrend, spendTrendPct } = computeSpendTrend(completedTrend);

  const previousActiveLicenses = priorMonthSnapshot.length;
  const previousExpectedMonthlyCents = priorMonthSnapshot.reduce(
    (s, a) => s + a.costAtAssignmentCents,
    0
  );
  const previousAssignmentsByTool: Record<number, number> = {};
  const previousSpendByTool: Record<number, number> = {};
  for (const a of priorMonthSnapshot) {
    previousAssignmentsByTool[a.toolId] =
      (previousAssignmentsByTool[a.toolId] ?? 0) + 1;
    previousSpendByTool[a.toolId] =
      (previousSpendByTool[a.toolId] ?? 0) + a.costAtAssignmentCents;
  }
  const hasPriorMonthData = priorMonthSnapshot.length > 0;

  const lastCompleted = completedTrend.at(-1) ?? null;
  const lastCompletedMonthLabel = lastCompleted?.label ?? null;
  const lastCompletedMonthVariancePct =
    lastCompleted && lastCompleted.plannedCents > 0
      ? ((lastCompleted.billedCents - lastCompleted.plannedCents) /
          lastCompleted.plannedCents) *
        100
      : null;

  const sparkSeries: SparklinePoint[] = trendsData
    .slice(-5)
    .map((p) => ({ label: p.month, value: p.expectedCents }))
    .concat({ label: "Now", value: totalMonthlySpend });

  const overview: ReportOverviewData = {
    totalActiveUsers,
    totalActiveTools,
    totalActiveLicenses: activeAssignments.length,
    expectedMonthlyCents: totalMonthlySpend,
    billedYtdCents,
    budgetCeilingCents,
    budgetRemainingCents,
    utilizationPct,
    spendTrend,
    spendTrendPct,
    previousMonth: hasPriorMonthData
      ? {
          activeLicenses: previousActiveLicenses,
          expectedMonthlyCents: previousExpectedMonthlyCents,
          assignmentsByTool: previousAssignmentsByTool,
          spendByTool: previousSpendByTool,
        }
      : undefined,
    budgetForecast: forecastData
      ? {
          status: forecastData.status,
          projectedAnnualTotalCents: forecastData.projectedAnnualTotalCents,
          projectedOverageCents:
            forecastData.projectedAnnualTotalCents -
            forecastData.budgetCeilingCents,
        }
      : null,
    lastCompletedMonthLabel,
    lastCompletedMonthVariancePct,
  };

  let thisMonth: AdminThisMonthSnapshot = {
    periodLabel: null,
    plannedCents: 0,
    actualCents: 0,
    billedCents: 0,
    runningCents: 0,
    variancePct: null,
  };
  let spendSeries: AdminSpendSeriesPoint[] = [];

  if (budgetWithCosts && activeBudget) {
    const pastOrCurrent = budgetWithCosts.periods.filter(
      (p) => new Date(p.startDate) <= today
    );
    const runningResults = await Promise.all(
      pastOrCurrent.map((p) => getRunningCostsForPeriod(p.id))
    );
    const runningByPeriod = new Map<number, number>();
    pastOrCurrent.forEach((p, i) => {
      runningByPeriod.set(p.id, runningResults[i]?.runningCostCents ?? 0);
    });

    const periodsWithActual: PeriodWithActual[] = budgetWithCosts.periods.map(
      (p) => {
        const running = runningByPeriod.get(p.id) ?? 0;
        return {
          ...p,
          runningCostCents: running,
          actualCents: p.billedTotalCents + running,
        };
      }
    );

    const current = periodsWithActual.find(
      (p) => classifyPeriod(p, today) === "current"
    );
    if (current) {
      const variancePct =
        current.plannedAmountCents > 0
          ? ((current.actualCents - current.plannedAmountCents) /
              current.plannedAmountCents) *
            100
          : null;
      thisMonth = {
        periodLabel: current.periodLabel,
        plannedCents: current.plannedAmountCents,
        actualCents: current.actualCents,
        billedCents: current.billedTotalCents,
        runningCents: current.runningCostCents,
        variancePct,
      };
    }

    spendSeries = periodsWithActual.map((p) => ({
      periodLabel: p.periodLabel,
      licensesCents: p.billedTotalCents,
      apiCents: p.runningCostCents,
      isForecast: classifyPeriod(p, today) === "future",
    }));
  }

  return {
    overview,
    toolSummary,
    expectedMonthlySparkline: sparkSeries,
    thisMonth,
    spendSeries,
    copilot: copilotResult,
    workspaceAlert: {
      topOverWorkspaceName: workspaceKpis.topOverWorkspaceName,
      topOverWorkspaceUtilizationPct: workspaceKpis.topOverWorkspaceUtilizationPct,
      workspacesOverEightyCount: workspaceKpis.workspacesOverEightyCount,
      workspacesWithLimitCount: workspaceKpis.workspacesWithLimitCount,
    },
    sync,
    activity,
    budgetCeilingCents,
    budgetOriginalCeilingCents,
    billedYtdCents,
  };
}

// `getCopilotOverview` runs an admin guard internally and we already gated this
// action on requireAdmin(). Treat any failure as "no copilot data" so the
// dashboard still renders when the GitHub connection is down.
async function safeCopilotAcceptance(): Promise<
  AdminDashboardData["copilot"]
> {
  try {
    const result = await getCopilotOverview();
    if (!result.success) return null;
    const trend = result.data.trends.map((t) => t.acceptanceRate);
    return {
      acceptanceRate:
        trend.length > 0
          ? Math.round(
              (result.data.totalAcceptances /
                Math.max(1, result.data.totalSuggestions)) *
                100
            )
          : null,
      totalActiveUsers: result.data.totalActiveUsers,
      trend,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Recent activity (admin)
// ---------------------------------------------------------------------------

export async function getRecentDashboardActivity(
  limit = 8
): Promise<DashboardActivityItem[]> {
  const admin = await requireAdmin();
  if (!admin) return [];

  const halfLimit = Math.max(5, Math.ceil(limit));

  const [ingestionRows, assignmentRows] = await Promise.all([
    db
      .select({
        id: ingestionLog.id,
        filename: ingestionLog.filename,
        vendor: ingestionLog.vendor,
        amountCents: ingestionLog.amountCents,
        outcome: ingestionLog.outcome,
        createdAt: ingestionLog.createdAt,
      })
      .from(ingestionLog)
      .orderBy(desc(ingestionLog.createdAt))
      .limit(halfLimit),
    db
      .select({
        id: licenseAssignments.id,
        userName: usersTable.name,
        toolName: aiTools.name,
        assignedAt: licenseAssignments.assignedAt,
        revokedAt: licenseAssignments.revokedAt,
      })
      .from(licenseAssignments)
      .innerJoin(usersTable, eq(licenseAssignments.userId, usersTable.id))
      .innerJoin(aiTools, eq(licenseAssignments.toolId, aiTools.id))
      .where(
        or(
          isNotNull(licenseAssignments.assignedAt),
          isNotNull(licenseAssignments.revokedAt)
        )
      )
      .orderBy(
        desc(sql`GREATEST(${licenseAssignments.assignedAt}, COALESCE(${licenseAssignments.revokedAt}, '1970-01-01'))`)
      )
      .limit(halfLimit),
  ]);

  const items: DashboardActivityItem[] = [];

  for (const row of ingestionRows) {
    const ts = row.createdAt.toISOString();
    const title = row.vendor
      ? `Invoice from ${row.vendor}`
      : row.filename
        ? `Invoice ${row.filename}`
        : "Invoice ingested";
    const detail =
      row.outcome === "success"
        ? row.amountCents !== null
          ? `Added · ${formatCurrency(row.amountCents)}`
          : "Added"
        : row.outcome === "filtered"
          ? "Filtered (duplicate)"
          : "Failed";
    const severity: DashboardActivityItem["severity"] =
      row.outcome === "success"
        ? "success"
        : row.outcome === "filtered"
          ? "info"
          : "danger";
    items.push({
      id: `ingestion-${row.id}`,
      kind: "ingestion",
      timestamp: ts,
      title,
      detail,
      severity,
    });
  }

  // Surface both grant and revoke events for the same assignment so the
  // timeline shows the lifecycle, not just the most recent state.
  for (const row of assignmentRows) {
    items.push({
      id: `assignment-${row.id}-added`,
      kind: "assignment_added",
      timestamp: row.assignedAt.toISOString(),
      title: `${row.userName} assigned ${row.toolName}`,
      detail: null,
      severity: "info",
    });
    if (row.revokedAt) {
      items.push({
        id: `assignment-${row.id}-revoked`,
        kind: "assignment_revoked",
        timestamp: row.revokedAt.toISOString(),
        title: `${row.userName} revoked from ${row.toolName}`,
        detail: null,
        severity: "warn",
      });
    }
  }

  items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return items.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Viewer dashboard data
// ---------------------------------------------------------------------------

export interface ViewerActivityItem {
  id: string;
  kind: "assignment_added" | "assignment_revoked";
  timestamp: string;
  toolName: string;
  tierName: string;
  costCents: number;
}

export interface ViewerSyncStatus {
  lastSyncedAt: string | null;
  ageMinutes: number | null;
  isStale: boolean;
  hasRow: boolean;
  errorMessage: string | null;
}

export interface ViewerToolRow {
  /** License assignment id. */
  id: number;
  /** AI tool id — used to derive distinct-tool counts. */
  toolId: number;
  toolName: string;
  vendor: string;
  tierName: string;
  status: "active" | "inactive";
  costCents: number;
  assignedAt: string;
  revokedAt: string | null;
  isAnthropic: boolean;
  hasApiKey: boolean;
}

export interface ViewerModelTotal {
  model: string;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
  /** Share of the month total, 0–100. */
  pct: number;
}

export interface ViewerDashboardData {
  profile: ProfileData["user"];
  cost: CostData;
  modelTotals: ViewerModelTotal[];
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheReadTokens: number;
  uncachedInputTokens: number;
  cacheSavingsCents: number;
  tools: ViewerToolRow[];
  activity: ViewerActivityItem[];
  sync: ViewerSyncStatus;
  availableToolCount: number;
}

export async function getViewerDashboardData(
  userId: number
): Promise<ViewerDashboardData | null> {
  const session = await auth();
  if (!session?.user) return null;
  const callerId = Number(session.user.id);
  if (callerId !== userId && session.user.role !== "admin") return null;

  const [profileData, assignmentRows, syncRow, toolCatalog] = await Promise.all([
    fetchProfileDataInternal(userId),
    db
      .select({
        id: licenseAssignments.id,
        toolId: licenseAssignments.toolId,
        toolName: aiTools.name,
        vendor: aiTools.vendor,
        tierName: accessTiers.name,
        status: licenseAssignments.status,
        costCents: licenseAssignments.costAtAssignmentCents,
        assignedAt: licenseAssignments.assignedAt,
        revokedAt: licenseAssignments.revokedAt,
        apiKeyEncrypted: licenseAssignments.apiKeyEncrypted,
      })
      .from(licenseAssignments)
      .innerJoin(aiTools, eq(licenseAssignments.toolId, aiTools.id))
      .innerJoin(accessTiers, eq(licenseAssignments.tierId, accessTiers.id))
      .where(eq(licenseAssignments.userId, userId))
      .orderBy(
        desc(sql`GREATEST(${licenseAssignments.assignedAt}, COALESCE(${licenseAssignments.revokedAt}, '1970-01-01'))`)
      )
      .limit(20),
    db.query.anthropicSyncStatus.findFirst({
      where: eq(anthropicSyncStatus.userId, userId),
    }),
    db
      .select({ id: aiTools.id })
      .from(aiTools)
      .where(eq(aiTools.status, "active")),
  ]);

  const cost = profileData.costData;
  const userToolIds = new Set(
    assignmentRows.filter((a) => a.status === "active").map((a) => a.toolId)
  );
  const availableToolCount = toolCatalog.filter((t) => !userToolIds.has(t.id))
    .length;

  const modelMap = new Map<
    string,
    { costCents: number; inputTokens: number; outputTokens: number }
  >();
  for (const day of cost.dailyBreakdown ?? []) {
    for (const m of day.models) {
      const entry = modelMap.get(m.model) ?? {
        costCents: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      entry.costCents += m.costCents;
      entry.inputTokens += m.inputTokens;
      entry.outputTokens += m.outputTokens;
      modelMap.set(m.model, entry);
    }
  }
  const totalCost = cost.monthlyTotalCents || 1;
  const modelTotals: ViewerModelTotal[] = Array.from(modelMap.entries())
    .map(([model, v]) => ({
      model,
      costCents: v.costCents,
      inputTokens: v.inputTokens,
      outputTokens: v.outputTokens,
      pct: Math.round((v.costCents / totalCost) * 100),
    }))
    .sort((a, b) => b.costCents - a.costCents);

  const totalInputTokens = modelTotals.reduce(
    (s, m) => s + m.inputTokens,
    0
  );
  const totalOutputTokens = modelTotals.reduce(
    (s, m) => s + m.outputTokens,
    0
  );

  let cacheReadTokens = 0;
  let uncachedInputTokens = 0;
  let cacheSavingsCents = 0;
  if (cost.available && cost.monthlyTotalCents > 0) {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const monthEnd = new Date(monthStart);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
    monthEnd.setUTCDate(0);

    const [agg] = await db
      .select({
        cacheRead: sum(anthropicUsageMetrics.cacheReadInputTokens),
        uncached: sum(anthropicUsageMetrics.uncachedInputTokens),
      })
      .from(anthropicUsageMetrics)
      .where(
        and(
          eq(anthropicUsageMetrics.userId, userId),
          gte(anthropicUsageMetrics.date, formatDateOnly(monthStart)),
          lte(anthropicUsageMetrics.date, formatDateOnly(monthEnd))
        )
      );

    cacheReadTokens = Number(agg?.cacheRead ?? 0);
    uncachedInputTokens = Number(agg?.uncached ?? 0);
    // Rough estimate: cache reads cost ~10% of uncached input tokens, so we
    // approximate savings as the share of cost attributable to cache reads,
    // multiplied by the 0.9 discount. Surfaced as "saved ~X", not exact.
    const inputCostShare =
      totalInputTokens > 0 ? cacheReadTokens / totalInputTokens : 0;
    cacheSavingsCents = Math.round(
      cost.monthlyTotalCents * inputCostShare * 0.9
    );
  }

  const tools: ViewerToolRow[] = assignmentRows.map((row) => ({
    id: row.id,
    toolId: row.toolId,
    toolName: row.toolName,
    vendor: row.vendor,
    tierName: row.tierName ?? "—",
    status: row.status as "active" | "inactive",
    costCents: row.costCents,
    assignedAt: row.assignedAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    isAnthropic: isAnthropicTool(row.vendor, row.toolName),
    hasApiKey: row.apiKeyEncrypted !== null && row.apiKeyEncrypted !== "",
  }));

  const activity: ViewerActivityItem[] = [];
  for (const row of assignmentRows.slice(0, 8)) {
    if (row.revokedAt) {
      activity.push({
        id: `assignment-${row.id}-revoked`,
        kind: "assignment_revoked",
        timestamp: row.revokedAt.toISOString(),
        toolName: row.toolName,
        tierName: row.tierName ?? "—",
        costCents: row.costCents,
      });
    }
    activity.push({
      id: `assignment-${row.id}-added`,
      kind: "assignment_added",
      timestamp: row.assignedAt.toISOString(),
      toolName: row.toolName,
      tierName: row.tierName ?? "—",
      costCents: row.costCents,
    });
  }
  activity.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const lastSyncedAtDate =
    syncRow?.workspaceSyncCompletedAt ?? syncRow?.lastSyncCompletedAt ?? null;
  const STALE_MINUTES = 24 * 60; // viewer's per-user sync runs much less often than the org-level one
  const ageMinutes = lastSyncedAtDate
    ? Math.floor((Date.now() - lastSyncedAtDate.getTime()) / 60_000)
    : null;
  const sync: ViewerSyncStatus = {
    lastSyncedAt: lastSyncedAtDate?.toISOString() ?? null,
    ageMinutes,
    isStale: ageMinutes === null || ageMinutes > STALE_MINUTES,
    hasRow: syncRow != null,
    errorMessage: syncRow?.lastSyncError ?? null,
  };

  return {
    profile: profileData.user,
    cost,
    modelTotals,
    totalInputTokens,
    totalOutputTokens,
    cacheReadTokens,
    uncachedInputTokens,
    cacheSavingsCents,
    tools: tools.slice(0, 12),
    activity: activity.slice(0, 8),
    sync,
    availableToolCount,
  };
}

function formatDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}
