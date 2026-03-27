"use server";

import { requireAdmin } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  anthropicWorkspaceCosts,
  anthropicWorkspaces,
  anthropicWorkspaceLimits,
  anthropicOrgConfig,
  anthropicPlanConnections,
  anthropicSyncStatus,
  syncEvents,
} from "@/lib/db/schema";
import { unstable_cache, revalidateTag, revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { format, endOfMonth, parseISO } from "date-fns";
import type {
  GlobalCostDashboardData,
  WorkspaceListItem,
  OrgCreditsStatus,
  PlanConnectionListItem,
} from "@/types";
import { run as runAnthropicSync } from "@/lib/sync/sources/anthropic-workspace";

// ---------------------------------------------------------------------------
// getGlobalCostDashboard (T014)
// ---------------------------------------------------------------------------

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

async function _getGlobalCostDashboard(
  month: string,
  planConnectionId?: number
): Promise<GlobalCostDashboardData> {
  const startDate = `${month}-01`;
  const endDate = format(endOfMonth(parseISO(`${month}-01`)), "yyyy-MM-dd");

  // Build cost query with optional plan filter
  const costConditions = [
    sql`${anthropicWorkspaceCosts.date} >= ${startDate}::date AND ${anthropicWorkspaceCosts.date} <= ${endDate}::date`,
  ];
  if (planConnectionId != null) {
    costConditions.push(
      sql`${anthropicWorkspaceCosts.planConnectionId} = ${planConnectionId}`
    );
  }

  const costRows = await db
    .select()
    .from(anthropicWorkspaceCosts)
    .where(sql.join(costConditions, sql` AND `));

  // Fetch workspace metadata with plan labels
  const workspaceRows = await db
    .select({
      workspaceId: anthropicWorkspaces.workspaceId,
      name: anthropicWorkspaces.name,
      planConnectionId: anthropicWorkspaces.planConnectionId,
      planLabel: anthropicPlanConnections.label,
    })
    .from(anthropicWorkspaces)
    .innerJoin(
      anthropicPlanConnections,
      eq(anthropicWorkspaces.planConnectionId, anthropicPlanConnections.id)
    );

  // Build workspace map (workspaceId:planId -> {name, planLabel, planConnectionId})
  const workspaceMap = new Map<string, { name: string; planLabel: string; planConnectionId: number }>();
  for (const ws of workspaceRows) {
    const key = `${ws.workspaceId ?? "null"}:${ws.planConnectionId}`;
    workspaceMap.set(key, {
      name: ws.name,
      planLabel: ws.planLabel,
      planConnectionId: ws.planConnectionId,
    });
  }

  // Group cost rows by workspaceId:planConnectionId
  const byWorkspace = new Map<
    string,
    { date: string; costCents: number }[]
  >();

  for (const row of costRows) {
    const key = `${row.workspaceId ?? "null"}:${row.planConnectionId}`;
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

  // Build workspace breakdown with plan labels
  const workspaceBreakdown: GlobalCostDashboardData["workspaceBreakdown"] = [];
  for (const [compositeKey, days] of byWorkspace.entries()) {
    const wsInfo = workspaceMap.get(compositeKey);
    const [wsId] = compositeKey.split(":");
    const workspaceId = wsId === "null" ? null : wsId;
    const name = wsInfo?.name ?? (workspaceId === null ? "Default Workspace" : workspaceId);
    const sortedDays = [...days].sort((a, b) => a.date.localeCompare(b.date));
    const totalCents = sortedDays.reduce((sum, d) => sum + d.costCents, 0);
    workspaceBreakdown.push({
      workspaceId,
      name,
      planLabel: wsInfo?.planLabel,
      planConnectionId: wsInfo?.planConnectionId,
      totalCents,
      dailyTotals: sortedDays,
    });
  }
  workspaceBreakdown.sort((a, b) => b.totalCents - a.totalCents);

  return { grandTotalCents, dailyTotals, workspaceBreakdown };
}

export async function getGlobalCostDashboard(
  month?: string,
  planConnectionId?: number
): Promise<GlobalCostDashboardData> {
  const admin = await requireAdmin();
  if (!admin) {
    return { grandTotalCents: 0, dailyTotals: [], workspaceBreakdown: [] };
  }

  const targetMonth = month && monthSchema.safeParse(month).success
    ? month
    : format(new Date(), "yyyy-MM");

  const cacheKey = planConnectionId
    ? `anthropic-global-cost-dashboard:${targetMonth}:plan_${planConnectionId}`
    : `anthropic-global-cost-dashboard:${targetMonth}`;

  return unstable_cache(
    () => _getGlobalCostDashboard(targetMonth, planConnectionId),
    [cacheKey],
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

  const rows = await db.execute(sql`
    SELECT
      w.workspace_id,
      w.name,
      w.is_default,
      w.is_archived,
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
    ORDER BY w.is_default DESC, w.name
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
