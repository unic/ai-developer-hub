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
  getDaysInMonth,
  parseISO,
  startOfMonth,
  subMonths,
} from "date-fns";
import { formatUtcDateOnly, getCurrentMonth, projectMonthEnd } from "@/lib/utils";
import {
  CALIBRATION_LOOKBACK_DAYS,
  estimateTodayCostCents,
  type TodayEstimate,
} from "@/lib/anthropic/estimate-today";
import type {
  DashboardKpis,
  SyncStatus,
  WorkspaceListItem,
} from "@/types";

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
// Today estimate (spec 033)
//
// The workspace/global cost_report source only has COMPLETE UTC days, so it is
// always missing today. We derive a calibrated estimate of today's spend from
// the hourly per-user usage source and carry it as a SEPARATE field — never
// merged into actuals. Computed here (uncached) so the cron evaluator gets a
// fresh value and the cached dashboard actions inherit the existing cadence.
// ---------------------------------------------------------------------------

type EstimateComponents = {
  todayUserCents: number;
  recentUserCents: number;
  recentWorkspaceCents: number;
};

type TodayEstimateInputs = {
  /** Per-user usage sync completion (sentinel row) — drives freshness/null. */
  asOf: Date | null;
  global: EstimateComponents;
  byWorkspace: Map<string | null, EstimateComponents>;
};

/**
 * One round-trip of the raw inputs for the today estimate, both globally and
 * per resolved workspace. Recent window is the last CALIBRATION_LOOKBACK_DAYS
 * COMPLETE UTC days, i.e. [today − N, today − 1].
 */
async function loadTodayEstimateInputs(now: Date): Promise<TodayEstimateInputs> {
  const todayStr = formatUtcDateOnly(now);
  const recentEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)
  );
  const recentStart = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - CALIBRATION_LOOKBACK_DAYS
    )
  );
  const recentStartStr = formatUtcDateOnly(recentStart);
  const recentEndStr = formatUtcDateOnly(recentEnd);

  const [todayUserRows, recentUserRows, recentWsRows, sentinelRow] =
    await Promise.all([
      db.execute<{ ws: string | null; cents: number }>(sql`
        SELECT s.resolved_workspace_id AS ws,
               COALESCE(SUM(m.computed_cost_cents), 0)::bigint AS cents
        FROM anthropic_usage_metrics m
        JOIN anthropic_sync_status s ON s.user_id = m.user_id
        WHERE m.date = ${todayStr}::date
        GROUP BY s.resolved_workspace_id
      `),
      db.execute<{ ws: string | null; cents: number }>(sql`
        SELECT s.resolved_workspace_id AS ws,
               COALESCE(SUM(m.computed_cost_cents), 0)::bigint AS cents
        FROM anthropic_usage_metrics m
        JOIN anthropic_sync_status s ON s.user_id = m.user_id
        WHERE m.date >= ${recentStartStr}::date AND m.date <= ${recentEndStr}::date
        GROUP BY s.resolved_workspace_id
      `),
      db.execute<{ ws: string | null; cents: number }>(sql`
        SELECT workspace_id AS ws,
               COALESCE(SUM(cost_cents), 0)::bigint AS cents
        FROM anthropic_workspace_costs
        WHERE date >= ${recentStartStr}::date AND date <= ${recentEndStr}::date
        GROUP BY workspace_id
      `),
      db.query.anthropicSyncStatus.findFirst({
        where: eq(anthropicSyncStatus.userId, SYNC_SENTINEL_USER_ID),
      }),
    ]);

  const byWorkspace = new Map<string | null, EstimateComponents>();
  const ensure = (ws: string | null): EstimateComponents => {
    let c = byWorkspace.get(ws);
    if (!c) {
      c = { todayUserCents: 0, recentUserCents: 0, recentWorkspaceCents: 0 };
      byWorkspace.set(ws, c);
    }
    return c;
  };
  const global: EstimateComponents = {
    todayUserCents: 0,
    recentUserCents: 0,
    recentWorkspaceCents: 0,
  };

  for (const r of todayUserRows.rows) {
    const cents = Number(r.cents ?? 0);
    ensure(r.ws ?? null).todayUserCents += cents;
    global.todayUserCents += cents;
  }
  for (const r of recentUserRows.rows) {
    const cents = Number(r.cents ?? 0);
    ensure(r.ws ?? null).recentUserCents += cents;
    global.recentUserCents += cents;
  }
  for (const r of recentWsRows.rows) {
    const cents = Number(r.cents ?? 0);
    ensure(r.ws ?? null).recentWorkspaceCents += cents;
    global.recentWorkspaceCents += cents;
  }

  return { asOf: sentinelRow?.lastSyncCompletedAt ?? null, global, byWorkspace };
}

/**
 * Build a TodayEstimate from raw components, or null when there is nothing
 * trustworthy to show: no per-user data for today, or the usage sync is stale
 * (older than STALE_MINUTES). The UI falls back to actual-only on null.
 */
function buildTodayEstimate(
  c: EstimateComponents,
  asOf: Date | null,
  now: Date
): TodayEstimate | null {
  if (!asOf) return null;
  if (now.getTime() - asOf.getTime() > STALE_MINUTES * 60_000) return null;
  if (c.todayUserCents <= 0) return null;
  const { estimatedTodayCents, calibration, confident } = estimateTodayCostCents(
    {
      todayUserCostCents: c.todayUserCents,
      recentUserCostCents: c.recentUserCents,
      recentWorkspaceCostCents: c.recentWorkspaceCents,
    }
  );
  if (estimatedTodayCents <= 0) return null;
  return {
    cents: estimatedTodayCents,
    rawUserCents: c.todayUserCents,
    calibration,
    confident,
    asOfIso: asOf.toISOString(),
  };
}

/** Calibrated estimate of the org-wide spend so far today, or null. */
export async function loadTodayEstimate(
  now: Date = new Date()
): Promise<TodayEstimate | null> {
  const { asOf, global } = await loadTodayEstimateInputs(now);
  return buildTodayEstimate(global, asOf, now);
}

/** Per-workspace today estimates (only workspaces with a non-null estimate). */
export async function loadTodayEstimatesByWorkspace(
  now: Date = new Date()
): Promise<Map<string | null, TodayEstimate>> {
  const { asOf, byWorkspace } = await loadTodayEstimateInputs(now);
  const out = new Map<string | null, TodayEstimate>();
  for (const [ws, c] of byWorkspace) {
    const est = buildTodayEstimate(c, asOf, now);
    if (est) out.set(ws, est);
  }
  return out;
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

  // Projection (spec 033): for the current month, count today in the
  // denominator (UTC day) AND add today's estimate to the numerator so the two
  // agree — otherwise the numerator skips today while the denominator counts it
  // (under-projects all month, projects 0 on the 1st). Past months: full month.
  const now = new Date();
  const isCurrentMonth = month === getCurrentMonth();
  const todayEstimate = isCurrentMonth ? await loadTodayEstimate(now) : null;
  const daysInMonth = getDaysInMonth(parseISO(monthStart));
  const daysElapsed = isCurrentMonth
    ? Math.max(1, now.getUTCDate())
    : daysInMonth;
  const spentSoFar = totalCents + (todayEstimate?.cents ?? 0);
  const projectedMonthEndCents = projectMonthEnd(
    spentSoFar,
    daysElapsed,
    daysInMonth
  );

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
    todayEstimate,
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

  // Per-workspace today estimate (separate field; never folded into the actual
  // currentMonthCents or utilizationPct). The list is always the current month.
  const estimates = await loadTodayEstimatesByWorkspace();

  return rows.rows.map((r) => {
    const currentMonthCents = Number(r.current_month_cents ?? 0);
    const limitCents = r.limit_cents != null ? Number(r.limit_cents) : null;
    const utilizationPct =
      limitCents != null && limitCents > 0
        ? Math.round((currentMonthCents / limitCents) * 100)
        : null;
    const workspaceId = r.workspace_id as string | null;
    return {
      workspaceId,
      name: r.name as string,
      isDefault: r.is_default as boolean,
      isArchived: r.is_archived as boolean,
      currentMonthCents,
      limitCents,
      utilizationPct,
      displayColor: (r.display_color as string | null) ?? null,
      todayEstimate: estimates.get(workspaceId) ?? null,
    };
  });
}
