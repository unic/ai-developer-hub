// Auth-free reads of Anthropic spend data. Callers MUST enforce auth:
// server actions call requireAdmin(); the cron evaluator runs under CRON_SECRET.
// `server-only` prevents accidental client bundling. Caching is the caller's
// responsibility (actions wrap with unstable_cache; evaluator wants fresh reads).

import "server-only";

import { db } from "@/lib/db";
import {
  anthropicSyncStatus,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  endOfMonth,
  format,
  getDate,
  getDaysInMonth,
  parseISO,
  startOfMonth,
  subDays,
  subMonths,
} from "date-fns";
import { projectMonthEnd } from "@/lib/utils";
import type {
  DashboardKpis,
  SyncStatus,
  WorkspaceListItem,
} from "@/types";

/** workspaceId → (YYYY-MM-DD date → cost in cents) for the requested lookback. */
export type CostHistoryByWorkspace = Map<string | null, Map<string, number>>;

const STALE_MINUTES = 70;
const SYNC_SENTINEL_USER_ID = 0;

// ---------------------------------------------------------------------------
// loadSyncStatus
// ---------------------------------------------------------------------------

export async function loadSyncStatus(): Promise<SyncStatus> {
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
// loadDashboardKpis
// ---------------------------------------------------------------------------

export async function loadDashboardKpis(month: string): Promise<DashboardKpis> {
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

// ---------------------------------------------------------------------------
// loadWorkspaceList
// ---------------------------------------------------------------------------

export async function loadWorkspaceList(): Promise<WorkspaceListItem[]> {
  const currentMonth = format(new Date(), "yyyy-MM");
  const startDate = `${currentMonth}-01`;
  const endDate = format(endOfMonth(parseISO(`${currentMonth}-01`)), "yyyy-MM-dd");

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

// ---------------------------------------------------------------------------
// loadCostHistory — one query, fanned out by workspace_id in JS.
// Replaces N separate per-workspace queries from forecastWorkspaceMonth.
// ---------------------------------------------------------------------------

export async function loadCostHistory(
  today: Date,
  lookbackDays: number,
): Promise<CostHistoryByWorkspace> {
  const start = format(subDays(today, lookbackDays - 1), "yyyy-MM-dd");
  const end = format(today, "yyyy-MM-dd");

  const rows = await db.execute<{
    workspace_id: string | null;
    date: string;
    cost_cents: number;
  }>(sql`
    SELECT workspace_id, date::text AS date, cost_cents
    FROM anthropic_workspace_costs
    WHERE date >= ${start}::date AND date <= ${end}::date
    ORDER BY workspace_id, date ASC
  `);

  const byWorkspace: CostHistoryByWorkspace = new Map();
  for (const r of rows.rows) {
    let inner = byWorkspace.get(r.workspace_id);
    if (!inner) {
      inner = new Map();
      byWorkspace.set(r.workspace_id, inner);
    }
    inner.set(r.date, Number(r.cost_cents));
  }
  return byWorkspace;
}
