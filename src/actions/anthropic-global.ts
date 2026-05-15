"use server";

import { requireAdmin } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  anthropicWorkspaceCosts,
  anthropicWorkspaces,
  anthropicWorkspaceLimits,
  anthropicOrgConfig,
  anthropicSyncStatus,
  syncEvents,
} from "@/lib/db/schema";
import { unstable_cache, revalidateTag, revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  format,
  endOfMonth,
  parseISO,
  subMonths,
  startOfMonth,
  getDate,
  getDaysInMonth,
} from "date-fns";
import type {
  GlobalCostDashboardData,
  WorkspaceListItem,
  OrgCreditsStatus,
  DashboardKpis,
  DailyStackedRow,
  SyncStatus,
  TwelveMonthRow,
  PacingRow,
  TopMover,
  WorkspaceSparkline,
} from "@/types";
import { projectMonthEnd } from "@/lib/utils";
import { run as runAnthropicSync } from "@/lib/sync/sources/anthropic-workspace";

// ---------------------------------------------------------------------------
// getGlobalCostDashboard (T014)
// ---------------------------------------------------------------------------

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

async function _getGlobalCostDashboard(month: string): Promise<GlobalCostDashboardData> {
  const startDate = `${month}-01`;
  const endDate = format(endOfMonth(parseISO(`${month}-01`)), "yyyy-MM-dd");

  // Fetch all workspace cost rows for the month
  const costRows = await db
    .select()
    .from(anthropicWorkspaceCosts)
    .where(
      sql`${anthropicWorkspaceCosts.date} >= ${startDate}::date AND ${anthropicWorkspaceCosts.date} <= ${endDate}::date`
    );

  // Fetch only the fields needed to build the workspace name map
  const workspaceRows = await db
    .select({ workspaceId: anthropicWorkspaces.workspaceId, name: anthropicWorkspaces.name })
    .from(anthropicWorkspaces);

  // Build workspace map (workspaceId -> name)
  const workspaceMap = new Map<string | null, string>();
  for (const ws of workspaceRows) {
    workspaceMap.set(ws.workspaceId, ws.name);
  }

  // Group cost rows by workspaceId
  const byWorkspace = new Map<
    string | null,
    { date: string; costCents: number }[]
  >();

  for (const row of costRows) {
    const key = row.workspaceId;
    if (!byWorkspace.has(key)) {
      byWorkspace.set(key, []);
    }
    byWorkspace.get(key)!.push({ date: row.date, costCents: row.costCents });
  }

  // Build daily totals across all workspaces
  const dailyMap = new Map<string, number>();
  for (const row of costRows) {
    dailyMap.set(row.date, (dailyMap.get(row.date) ?? 0) + row.costCents);
  }
  const dailyTotals = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, costCents]) => ({ date, costCents }));

  const grandTotalCents = dailyTotals.reduce((sum, d) => sum + d.costCents, 0);

  // Build workspace breakdown
  const workspaceBreakdown: GlobalCostDashboardData["workspaceBreakdown"] = [];
  for (const [workspaceId, days] of byWorkspace.entries()) {
    const name = workspaceMap.get(workspaceId) ?? (workspaceId === null ? "Default Workspace" : workspaceId);
    const sortedDays = [...days].sort((a, b) => a.date.localeCompare(b.date));
    const totalCents = sortedDays.reduce((sum, d) => sum + d.costCents, 0);
    workspaceBreakdown.push({
      workspaceId,
      name,
      totalCents,
      dailyTotals: sortedDays,
    });
  }
  workspaceBreakdown.sort((a, b) => b.totalCents - a.totalCents);

  return { grandTotalCents, dailyTotals, workspaceBreakdown };
}

export async function getGlobalCostDashboard(
  month?: string
): Promise<GlobalCostDashboardData> {
  const admin = await requireAdmin();
  if (!admin) {
    return { grandTotalCents: 0, dailyTotals: [], workspaceBreakdown: [] };
  }

  const targetMonth = month && monthSchema.safeParse(month).success
    ? month
    : format(new Date(), "yyyy-MM");

  return unstable_cache(
    () => _getGlobalCostDashboard(targetMonth),
    ["anthropic-global-cost-dashboard", targetMonth],
    { tags: ["anthropic-workspace-costs"] }
  )();
}

// ---------------------------------------------------------------------------
// getAvailableWorkspaceCostMonths / getAvailableMonths (T015 + T032)
// ---------------------------------------------------------------------------

async function _getAvailableWorkspaceCostMonths(): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT TO_CHAR(DATE_TRUNC('month', date::date), 'YYYY-MM') as month
    FROM anthropic_workspace_costs
    ORDER BY 1 DESC
  `);
  return rows.rows.map((r) => r.month as string);
}

export async function getAvailableWorkspaceCostMonths(): Promise<string[]> {
  const admin = await requireAdmin();
  if (!admin) return [];
  return unstable_cache(
    _getAvailableWorkspaceCostMonths,
    ["anthropic-available-months"],
    { tags: ["anthropic-workspace-costs"] }
  )();
}

export const getAvailableMonths = getAvailableWorkspaceCostMonths;

// ---------------------------------------------------------------------------
// getWorkspaceList (T020)
// ---------------------------------------------------------------------------

async function _getWorkspaceList(): Promise<WorkspaceListItem[]> {
  const currentMonth = format(new Date(), "yyyy-MM");
  const startDate = `${currentMonth}-01`;
  const endDate = format(endOfMonth(parseISO(`${currentMonth}-01`)), "yyyy-MM-dd");

  // Sort order (spec 026 T115):
  //   1. over 100% (utilization >= 100, limited)
  //   2. over 80% (80 <= utilization < 100, limited)
  //   3. with-limit by utilization DESC
  //   4. no-limit by spend DESC
  //   5. $0 + no-limit last
  const rows = await db.execute(sql`
    SELECT
      w.workspace_id,
      w.name,
      w.is_default,
      w.is_archived,
      w.display_color,
      COALESCE(c.total_cents, 0) as current_month_cents,
      l.limit_cents
    FROM anthropic_workspaces w
    LEFT JOIN (
      SELECT workspace_id, SUM(cost_cents) as total_cents
      FROM anthropic_workspace_costs
      WHERE date >= ${startDate}::date AND date <= ${endDate}::date
      GROUP BY workspace_id
    ) c ON c.workspace_id IS NOT DISTINCT FROM w.workspace_id
    LEFT JOIN anthropic_workspace_limits l
      ON l.workspace_id IS NOT DISTINCT FROM w.workspace_id
    WHERE w.is_archived = false
    ORDER BY
      CASE
        WHEN l.limit_cents IS NOT NULL AND l.limit_cents > 0
             AND COALESCE(c.total_cents, 0) >= l.limit_cents THEN 1
        WHEN l.limit_cents IS NOT NULL AND l.limit_cents > 0
             AND COALESCE(c.total_cents, 0) >= 0.8 * l.limit_cents THEN 2
        WHEN l.limit_cents IS NOT NULL AND l.limit_cents > 0 THEN 3
        WHEN COALESCE(c.total_cents, 0) > 0 THEN 4
        ELSE 5
      END,
      CASE
        WHEN l.limit_cents IS NOT NULL AND l.limit_cents > 0
          THEN (COALESCE(c.total_cents, 0)::float / l.limit_cents)
        ELSE NULL
      END DESC NULLS LAST,
      COALESCE(c.total_cents, 0) DESC,
      w.name ASC
  `);

  return rows.rows.map((r) => {
    const currentMonthCents = Number(r.current_month_cents ?? 0);
    const limitCents = r.limit_cents != null ? Number(r.limit_cents) : null;
    const utilizationPct =
      limitCents != null && limitCents > 0
        ? Math.round((currentMonthCents / limitCents) * 100)
        : null;
    return {
      workspaceId: r.workspace_id as string | null,
      name: r.name as string,
      isDefault: r.is_default as boolean,
      isArchived: r.is_archived as boolean,
      currentMonthCents,
      limitCents,
      utilizationPct,
      displayColor: (r.display_color as string | null) ?? null,
    };
  });
}

export async function getWorkspaceList(): Promise<WorkspaceListItem[]> {
  const admin = await requireAdmin();
  if (!admin) return [];

  return unstable_cache(
    _getWorkspaceList,
    ["anthropic-workspace-list"],
    { tags: ["anthropic-workspace-costs"] }
  )();
}

// ---------------------------------------------------------------------------
// setWorkspaceLimit (T021)
// ---------------------------------------------------------------------------

const limitSchema = z
  .number()
  .int()
  .positive()
  .nullable();

export async function setWorkspaceLimit(
  workspaceId: string | null,
  limitCents: number | null
): Promise<{ success: true } | { success: false; error: string }> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = limitSchema.safeParse(limitCents);
  if (!parsed.success) {
    return { success: false, error: "Invalid limit value" };
  }

  try {
    if (limitCents === null) {
      // Delete the row
      if (workspaceId === null) {
        await db
          .delete(anthropicWorkspaceLimits)
          .where(sql`${anthropicWorkspaceLimits.workspaceId} IS NULL`);
      } else {
        await db
          .delete(anthropicWorkspaceLimits)
          .where(eq(anthropicWorkspaceLimits.workspaceId, workspaceId));
      }
    } else if (workspaceId === null) {
      // Default workspace: no ON CONFLICT on nullable column — use explicit update-or-insert
      // Wrapped in a transaction to prevent a race between the update and the fallback insert.
      await db.transaction(async (tx) => {
        const updated = await tx
          .update(anthropicWorkspaceLimits)
          .set({ limitCents, updatedAt: new Date() })
          .where(sql`${anthropicWorkspaceLimits.workspaceId} IS NULL`);
        if (updated.rowCount === 0) {
          await tx.insert(anthropicWorkspaceLimits).values({ workspaceId: null, limitCents });
        }
      });
    } else {
      // Named workspace: target the partial unique index (workspaceId IS NOT NULL)
      await db
        .insert(anthropicWorkspaceLimits)
        .values({ workspaceId, limitCents })
        .onConflictDoUpdate({
          target: [anthropicWorkspaceLimits.workspaceId],
          targetWhere: sql`${anthropicWorkspaceLimits.workspaceId} IS NOT NULL`,
          set: { limitCents, updatedAt: new Date() },
        });
    }

    revalidateTag("anthropic-workspace-costs");
    revalidateTag("alerts");
    revalidatePath("/claude");
    return { success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// getOrgConfig (T027)
// ---------------------------------------------------------------------------

async function _getOrgConfig(): Promise<{ billingBudgetLimitCents: number | null } | null> {
  const row = await db.query.anthropicOrgConfig.findFirst({
    where: eq(anthropicOrgConfig.id, 1),
  });
  if (!row) return null;
  return { billingBudgetLimitCents: row.billingBudgetLimitCents ?? null };
}

export async function getOrgConfig(): Promise<{ billingBudgetLimitCents: number | null } | null> {
  const admin = await requireAdmin();
  if (!admin) return null;

  return unstable_cache(
    _getOrgConfig,
    ["anthropic-org-config"],
    { tags: ["alerts"] }
  )();
}

// ---------------------------------------------------------------------------
// setOrgBillingBudget (T028)
// ---------------------------------------------------------------------------

const billingBudgetSchema = z.number().int().positive().nullable();

export async function setOrgBillingBudget(
  limitCents: number | null
): Promise<{ success: true } | { success: false; error: string }> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = billingBudgetSchema.safeParse(limitCents);
  if (!parsed.success) {
    return { success: false, error: "Invalid limit value" };
  }

  try {
    await db
      .insert(anthropicOrgConfig)
      .values({ id: 1, billingBudgetLimitCents: limitCents, updatedAt: new Date(), updatedBy: Number(admin.id) })
      .onConflictDoUpdate({
        target: [anthropicOrgConfig.id],
        set: { billingBudgetLimitCents: limitCents, updatedAt: new Date(), updatedBy: Number(admin.id) },
      });

    revalidateTag("alerts");
    revalidatePath("/claude");
    return { success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// getOrgCreditsStatus (T029)
// ---------------------------------------------------------------------------

export async function getOrgCreditsStatus(): Promise<OrgCreditsStatus> {
  return { available: false, reason: "not_exposed_by_api" };
}

// ---------------------------------------------------------------------------
// syncWorkspacesManual (T035 empty state)
// ---------------------------------------------------------------------------

export async function syncWorkspacesManual(): Promise<
  { success: true } | { success: false; error: string }
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  try {
    const { eventId } = await runAnthropicSync(admin.id ? Number(admin.id) : undefined);

    // Check sync event outcome — the sync framework records failures without throwing
    const [event] = await db
      .select({ outcome: syncEvents.outcome, errorMessage: syncEvents.errorMessage })
      .from(syncEvents)
      .where(eq(syncEvents.id, eventId))
      .limit(1);

    if (!event || event.outcome !== "success") {
      return {
        success: false,
        error: event?.errorMessage ?? "Sync did not complete successfully",
      };
    }

    revalidateTag("anthropic-workspace-costs");
    revalidateTag("alerts");
    revalidatePath("/claude");

    return { success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Spec 026 — Phase 1 additions
// ---------------------------------------------------------------------------

async function _getDashboardKpis(month: string): Promise<DashboardKpis> {
  const monthStart = `${month}-01`;
  const monthEnd = format(endOfMonth(parseISO(monthStart)), "yyyy-MM-dd");
  const priorMonthDate = subMonths(parseISO(monthStart), 1);
  const priorMonthStart = format(startOfMonth(priorMonthDate), "yyyy-MM-dd");
  const priorMonthEnd = format(endOfMonth(priorMonthDate), "yyyy-MM-dd");

  const totalsResult = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN date >= ${monthStart}::date AND date <= ${monthEnd}::date THEN cost_cents ELSE 0 END), 0) AS total_cents,
      COALESCE(SUM(CASE WHEN date >= ${priorMonthStart}::date AND date <= ${priorMonthEnd}::date THEN cost_cents ELSE 0 END), 0) AS prior_cents
    FROM anthropic_workspace_costs
  `);
  const totalsRow = totalsResult.rows[0];
  const totalCents = Number(totalsRow?.total_cents ?? 0);
  const priorMonthCents = Number(totalsRow?.prior_cents ?? 0);
  const momDeltaCents = totalCents - priorMonthCents;
  const momDeltaPct =
    priorMonthCents < 100
      ? null
      : Math.round((momDeltaCents / priorMonthCents) * 100);

  const nowMonth = format(new Date(), "yyyy-MM");
  const daysInMonth = getDaysInMonth(parseISO(monthStart));
  const daysElapsed =
    month === nowMonth ? Math.max(1, getDate(new Date())) : daysInMonth;
  const projectedMonthEndCents = projectMonthEnd(totalCents, daysElapsed, daysInMonth);

  const overRows = await db.execute(sql`
    SELECT
      w.workspace_id,
      w.name,
      COALESCE(c.total_cents, 0) AS current_month_cents,
      l.limit_cents
    FROM anthropic_workspaces w
    LEFT JOIN (
      SELECT workspace_id, SUM(cost_cents) AS total_cents
      FROM anthropic_workspace_costs
      WHERE date >= ${monthStart}::date AND date <= ${monthEnd}::date
      GROUP BY workspace_id
    ) c ON c.workspace_id IS NOT DISTINCT FROM w.workspace_id
    LEFT JOIN anthropic_workspace_limits l
      ON l.workspace_id IS NOT DISTINCT FROM w.workspace_id
    WHERE w.is_archived = false
      AND l.limit_cents IS NOT NULL
      AND l.limit_cents > 0
  `);

  let overCount = 0;
  let workspacesWithLimitCount = 0;
  let topName: string | null = null;
  let topPct: number | null = null;
  for (const r of overRows.rows) {
    const limit = Number(r.limit_cents);
    const cents = Number(r.current_month_cents ?? 0);
    workspacesWithLimitCount += 1;
    const pct = Math.round((cents / limit) * 100);
    if (pct >= 80) overCount += 1;
    if (topPct === null || pct > topPct) {
      topPct = pct;
      topName = (r.name as string) ?? null;
    }
  }

  return {
    totalCents,
    momDeltaCents,
    momDeltaPct,
    projectedMonthEndCents,
    workspacesOverEightyCount: overCount,
    workspacesWithLimitCount,
    topOverWorkspaceName: overCount > 0 ? topName : null,
    topOverWorkspaceUtilizationPct: overCount > 0 ? topPct : null,
    priorMonthCents,
  };
}

export async function getDashboardKpis(month?: string): Promise<DashboardKpis> {
  const admin = await requireAdmin();
  if (!admin) {
    return {
      totalCents: 0,
      momDeltaCents: 0,
      momDeltaPct: null,
      projectedMonthEndCents: 0,
      workspacesOverEightyCount: 0,
      workspacesWithLimitCount: 0,
      topOverWorkspaceName: null,
      topOverWorkspaceUtilizationPct: null,
      priorMonthCents: 0,
    };
  }
  const targetMonth =
    month && monthSchema.safeParse(month).success
      ? month
      : format(new Date(), "yyyy-MM");

  return unstable_cache(
    () => _getDashboardKpis(targetMonth),
    ["anthropic-dashboard-kpis", targetMonth],
    { tags: ["anthropic-workspace-costs"] }
  )();
}

const TOP_STACKED_LIMIT = 8;
const STACKED_OTHER_KEY = "__other__";
const STACKED_NULL_KEY = "__default__";

async function _getDailyTotalsByWorkspace(month: string): Promise<{
  rows: DailyStackedRow[];
  topWorkspaces: { key: string; name: string; displayColor: string | null }[];
}> {
  const monthStart = `${month}-01`;
  const monthEnd = format(endOfMonth(parseISO(monthStart)), "yyyy-MM-dd");

  const costRows = await db.execute(sql`
    SELECT date::text AS date, workspace_id, cost_cents
    FROM anthropic_workspace_costs
    WHERE date >= ${monthStart}::date AND date <= ${monthEnd}::date
  `);

  const wsMeta = await db.execute(sql`
    SELECT workspace_id, name, display_color
    FROM anthropic_workspaces
  `);

  const nameMap = new Map<string, { name: string; color: string | null }>();
  for (const r of wsMeta.rows) {
    const key = (r.workspace_id as string | null) ?? STACKED_NULL_KEY;
    nameMap.set(key, {
      name: r.name as string,
      color: (r.display_color as string | null) ?? null,
    });
  }

  const totals = new Map<string, number>();
  for (const r of costRows.rows) {
    const key = (r.workspace_id as string | null) ?? STACKED_NULL_KEY;
    totals.set(key, (totals.get(key) ?? 0) + Number(r.cost_cents ?? 0));
  }
  const ranked = Array.from(totals.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      const nameA = nameMap.get(a[0])?.name ?? a[0];
      const nameB = nameMap.get(b[0])?.name ?? b[0];
      return nameA.localeCompare(nameB);
    })
    .map(([key]) => key);

  const topKeys = new Set(ranked.slice(0, TOP_STACKED_LIMIT));
  const hasOther = ranked.length > TOP_STACKED_LIMIT;

  const dayMap = new Map<string, DailyStackedRow>();
  for (const r of costRows.rows) {
    const date = r.date as string;
    const key = (r.workspace_id as string | null) ?? STACKED_NULL_KEY;
    const cents = Number(r.cost_cents ?? 0);
    let row = dayMap.get(date);
    if (!row) {
      row = { date, perWorkspace: {}, total: 0 };
      dayMap.set(date, row);
    }
    const bucket = topKeys.has(key) ? key : STACKED_OTHER_KEY;
    row.perWorkspace[bucket] = (row.perWorkspace[bucket] ?? 0) + cents;
    row.total += cents;
  }

  const rows = Array.from(dayMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  const topWorkspaces = ranked.slice(0, TOP_STACKED_LIMIT).map((key) => ({
    key,
    name:
      nameMap.get(key)?.name ??
      (key === STACKED_NULL_KEY ? "Default Workspace" : key),
    displayColor: nameMap.get(key)?.color ?? null,
  }));
  if (hasOther) {
    topWorkspaces.push({ key: STACKED_OTHER_KEY, name: "Other", displayColor: null });
  }

  return { rows, topWorkspaces };
}

export async function getDailyTotalsByWorkspace(month?: string): Promise<{
  rows: DailyStackedRow[];
  topWorkspaces: { key: string; name: string; displayColor: string | null }[];
}> {
  const admin = await requireAdmin();
  if (!admin) return { rows: [], topWorkspaces: [] };

  const targetMonth =
    month && monthSchema.safeParse(month).success
      ? month
      : format(new Date(), "yyyy-MM");

  return unstable_cache(
    () => _getDailyTotalsByWorkspace(targetMonth),
    ["anthropic-daily-stacked", targetMonth],
    { tags: ["anthropic-workspace-costs"] }
  )();
}

const STALE_MINUTES = 70;
const SYNC_SENTINEL_USER_ID = 0;

export async function getSyncStatus(): Promise<SyncStatus> {
  const admin = await requireAdmin();
  if (!admin) {
    return { lastSyncedAt: null, ageMinutes: null, isStale: true };
  }

  const row = await db.query.anthropicSyncStatus.findFirst({
    where: eq(anthropicSyncStatus.userId, SYNC_SENTINEL_USER_ID),
  });
  const lastSyncedAt =
    row?.workspaceSyncCompletedAt ?? row?.lastSyncCompletedAt ?? null;
  if (!lastSyncedAt) {
    return { lastSyncedAt: null, ageMinutes: null, isStale: true };
  }
  const ageMs = Date.now() - lastSyncedAt.getTime();
  const ageMinutes = Math.floor(ageMs / 60_000);
  return {
    lastSyncedAt,
    ageMinutes,
    isStale: ageMinutes > STALE_MINUTES,
  };
}

// ---------------------------------------------------------------------------
// Spec 026 — Phase 2 additions (historical trend + sparklines)
// ---------------------------------------------------------------------------

const TOP_MOVERS_FLOOR_CENTS = 500;
const SPARKLINE_MONTHS = 6;

async function _getTwelveMonthTotals(): Promise<TwelveMonthRow[]> {
  const rows = await db.execute(sql`
    SELECT
      to_char(date_trunc('month', date), 'YYYY-MM') AS month,
      COALESCE(SUM(cost_cents), 0)::bigint AS total_cents
    FROM anthropic_workspace_costs
    WHERE date >= (date_trunc('month', current_date) - interval '11 months')::date
    GROUP BY 1
    ORDER BY 1
  `);

  const cfg = await db.query.anthropicOrgConfig.findFirst({
    where: eq(anthropicOrgConfig.id, 1),
  });
  const cap = cfg?.billingBudgetLimitCents ?? null;

  return rows.rows.map((r) => ({
    month: r.month as string,
    totalCents: Number(r.total_cents ?? 0),
    budgetLimitCents: cap,
  }));
}

export async function getTwelveMonthTotals(): Promise<TwelveMonthRow[]> {
  const admin = await requireAdmin();
  if (!admin) return [];
  return unstable_cache(
    _getTwelveMonthTotals,
    ["anthropic-twelve-month"],
    { tags: ["anthropic-workspace-costs"] }
  )();
}

async function _getCumulativePacing(): Promise<PacingRow[]> {
  // Window function: cumulative SUM by day-of-month for the last 4 months.
  const rows = await db.execute(sql`
    SELECT
      to_char(date_trunc('month', date), 'YYYY-MM') AS month,
      EXTRACT(DAY FROM date)::int AS day_of_month,
      SUM(cost_cents) OVER (
        PARTITION BY date_trunc('month', date)
        ORDER BY date
      )::bigint AS cumulative_cents
    FROM (
      SELECT date, SUM(cost_cents)::bigint AS cost_cents
      FROM anthropic_workspace_costs
      WHERE date >= (date_trunc('month', current_date) - interval '3 months')::date
      GROUP BY date
    ) daily
    ORDER BY month, day_of_month
  `);

  // Pivot per (dayOfMonth, monthOffset 0=current, 1=prev, 2=2-back, 3=3-back).
  const months = new Set<string>();
  for (const r of rows.rows) months.add(r.month as string);
  const sortedMonths = Array.from(months).sort().reverse(); // newest first

  const dayMap = new Map<number, PacingRow>();
  for (const r of rows.rows) {
    const dom = r.day_of_month as number;
    const month = r.month as string;
    const cents = Number(r.cumulative_cents ?? 0);
    const offset = sortedMonths.indexOf(month);
    let row = dayMap.get(dom);
    if (!row) {
      row = { dayOfMonth: dom, current: null, m1: null, m2: null, m3: null };
      dayMap.set(dom, row);
    }
    if (offset === 0) row.current = cents;
    else if (offset === 1) row.m1 = cents;
    else if (offset === 2) row.m2 = cents;
    else if (offset === 3) row.m3 = cents;
  }

  // Pad missing days 1..maxDayOfMonth
  const maxDay = Math.max(31, ...Array.from(dayMap.keys()));
  for (let d = 1; d <= maxDay; d++) {
    if (!dayMap.has(d)) {
      dayMap.set(d, { dayOfMonth: d, current: null, m1: null, m2: null, m3: null });
    }
  }
  return Array.from(dayMap.values()).sort((a, b) => a.dayOfMonth - b.dayOfMonth);
}

export async function getCumulativePacing(): Promise<PacingRow[]> {
  const admin = await requireAdmin();
  if (!admin) return [];
  return unstable_cache(
    _getCumulativePacing,
    ["anthropic-cumulative-pacing"],
    { tags: ["anthropic-workspace-costs"] }
  )();
}

async function _getTopMovers(): Promise<TopMover[]> {
  // Compare newest 3 months vs the oldest 3 months of the last 6.
  // Floor on prior_cents >= 500 cents ($5) to suppress noise.
  const rows = await db.execute(sql`
    WITH window6 AS (
      SELECT
        c.workspace_id,
        date_trunc('month', c.date) AS month,
        SUM(c.cost_cents)::bigint AS cents
      FROM anthropic_workspace_costs c
      WHERE c.date >= (date_trunc('month', current_date) - interval '5 months')::date
      GROUP BY c.workspace_id, date_trunc('month', c.date)
    ),
    bounds AS (
      SELECT
        date_trunc('month', current_date) AS curr_month,
        date_trunc('month', current_date) - interval '5 months' AS oldest_month
    ),
    classified AS (
      SELECT
        w6.workspace_id,
        CASE
          WHEN w6.month >= (SELECT curr_month FROM bounds) - interval '2 months' THEN 'new'
          ELSE 'old'
        END AS bucket,
        w6.cents
      FROM window6 w6
    )
    SELECT
      workspace_id,
      COALESCE(SUM(CASE WHEN bucket = 'new' THEN cents ELSE 0 END), 0)::bigint AS new_cents,
      COALESCE(SUM(CASE WHEN bucket = 'old' THEN cents ELSE 0 END), 0)::bigint AS old_cents
    FROM classified
    GROUP BY workspace_id
  `);

  const wsMeta = await db.execute(sql`
    SELECT workspace_id, name FROM anthropic_workspaces WHERE is_archived = false
  `);
  const nameMap = new Map<string | null, string>();
  for (const r of wsMeta.rows) {
    nameMap.set(r.workspace_id as string | null, r.name as string);
  }

  const movers: TopMover[] = [];
  for (const r of rows.rows) {
    const newCents = Number(r.new_cents ?? 0);
    const oldCents = Number(r.old_cents ?? 0);
    if (oldCents < TOP_MOVERS_FLOOR_CENTS) continue;
    const delta = newCents - oldCents;
    if (delta <= 0) continue;
    const pct = Math.round((delta / oldCents) * 100);
    const wsId = (r.workspace_id as string | null) ?? null;
    movers.push({
      workspaceId: wsId,
      name: nameMap.get(wsId) ?? (wsId === null ? "Default Workspace" : (wsId as string)),
      priorCents: oldCents,
      currentCents: newCents,
      deltaCents: delta,
      deltaPct: pct,
      direction: "up",
    });
  }
  return movers.sort((a, b) => b.deltaPct - a.deltaPct).slice(0, 3);
}

export async function getTopMovers(): Promise<TopMover[]> {
  const admin = await requireAdmin();
  if (!admin) return [];
  return unstable_cache(
    _getTopMovers,
    ["anthropic-top-movers"],
    { tags: ["anthropic-workspace-costs"] }
  )();
}

async function _getWorkspaceSparklines(): Promise<Record<string, WorkspaceSparkline>> {
  const rows = await db.execute(sql`
    SELECT
      COALESCE(workspace_id, '__default__') AS key,
      to_char(date_trunc('month', date), 'YYYY-MM') AS month,
      COALESCE(SUM(cost_cents), 0)::bigint AS cents
    FROM anthropic_workspace_costs
    WHERE date >= (date_trunc('month', current_date) - interval '5 months')::date
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);

  const out: Record<string, WorkspaceSparkline> = {};
  for (const r of rows.rows) {
    const key = r.key as string;
    if (!out[key]) out[key] = { workspaceKey: key, months: [] };
    out[key].months.push({
      month: r.month as string,
      totalCents: Number(r.cents ?? 0),
    });
  }
  return out;
}

export async function getWorkspaceSparklines(): Promise<
  Record<string, WorkspaceSparkline>
> {
  const admin = await requireAdmin();
  if (!admin) return {};
  return unstable_cache(
    _getWorkspaceSparklines,
    ["anthropic-workspace-sparklines", String(SPARKLINE_MONTHS)],
    { tags: ["anthropic-workspace-costs"] }
  )();
}
