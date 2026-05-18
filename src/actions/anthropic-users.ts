"use server";

import { requireAdmin } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { unstable_cache } from "next/cache";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { format, endOfMonth, parseISO, subMonths, startOfMonth } from "date-fns";
import { LOCK_USER_ID } from "@/lib/anthropic-sync";
import {
  topNConcentrationPct,
  activeUserDeltaPct,
  countUsersWithNoApiKey,
} from "@/lib/anthropic-users-utils";
import type {
  UserListRow,
  UsersDashboardKpis,
  UserProfile,
  UserStatus,
} from "@/types";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

// ---------------------------------------------------------------------------
// getUserList — T105
// ---------------------------------------------------------------------------

interface UserListResult {
  users: UserListRow[];
  totalCents: number;
  periodStart: string;
  periodEnd: string;
  hasUnresolvedPricing: boolean;
}

async function _getUserList(month: string): Promise<UserListResult> {
  const periodStart = `${month}-01`;
  const periodEnd = format(endOfMonth(parseISO(periodStart)), "yyyy-MM-dd");

  // Canonical query from data-model.md. LEFT JOIN on usage so users with zero
  // spend in the period still surface — required for the "users with no API
  // key" KPI to make sense. `IS NOT DISTINCT FROM` on the workspace join keeps
  // null workspace (default) joinable like any other workspace_id.
  // Also pull `bool_or(NOT m.pricing_resolved)` so the UI can flag affected rows.
  const rows = await db.execute(sql`
    SELECT
      u.id            AS user_id,
      u.email,
      u.name,
      u.circle,
      u.profile,
      u.status,
      s.resolved_workspace_id,
      s.resolved_api_key_id,
      w.name          AS workspace_name,
      w.display_color AS workspace_color,
      COALESCE(SUM(m.computed_cost_cents), 0)::bigint AS cents,
      COALESCE(SUM(
        m.uncached_input_tokens
        + m.cache_read_input_tokens
        + m.cache_creation_input_tokens
        + m.output_tokens
      ), 0)::bigint AS total_tokens,
      COUNT(DISTINCT m.model)::int AS models_used,
      MAX(m.date)     AS last_active,
      COALESCE(bool_or(NOT m.pricing_resolved), false) AS has_unresolved_pricing
    FROM users u
    LEFT JOIN anthropic_usage_metrics m
           ON m.user_id = u.id
          AND m.date BETWEEN ${periodStart}::date AND ${periodEnd}::date
    LEFT JOIN anthropic_sync_status s
           ON s.user_id = u.id
    LEFT JOIN anthropic_workspaces w
           ON w.workspace_id IS NOT DISTINCT FROM s.resolved_workspace_id
    WHERE u.id <> ${LOCK_USER_ID}
    GROUP BY u.id, u.email, u.name, u.circle, u.profile, u.status,
             s.resolved_workspace_id, s.resolved_api_key_id, w.name, w.display_color
    ORDER BY cents DESC, u.email ASC
  `);

  const users: UserListRow[] = rows.rows.map((r) => ({
    userId: Number(r.user_id),
    email: r.email as string,
    name: (r.name as string | null) ?? "",
    circle: (r.circle as string | null) ?? null,
    profile: (r.profile as UserProfile | null) ?? null,
    status: r.status as UserStatus,
    workspaceId: (r.resolved_workspace_id as string | null) ?? null,
    workspaceName: (r.workspace_name as string | null) ?? null,
    workspaceColor: (r.workspace_color as string | null) ?? null,
    hasApiKey: r.resolved_api_key_id != null,
    costCents: Number(r.cents ?? 0),
    totalTokens: Number(r.total_tokens ?? 0),
    modelsUsed: Number(r.models_used ?? 0),
    lastActive: (r.last_active as string | null) ?? null,
    hasUnresolvedPricing: Boolean(r.has_unresolved_pricing),
  }));

  const totalCents = users.reduce((s, u) => s + u.costCents, 0);
  const hasUnresolvedPricing = users.some((u) => u.hasUnresolvedPricing);

  return { users, totalCents, periodStart, periodEnd, hasUnresolvedPricing };
}

export async function getUserList(month?: string): Promise<UserListResult> {
  const admin = await requireAdmin();
  if (!admin) {
    const now = format(new Date(), "yyyy-MM");
    const periodStart = `${now}-01`;
    const periodEnd = format(endOfMonth(parseISO(periodStart)), "yyyy-MM-dd");
    return {
      users: [],
      totalCents: 0,
      periodStart,
      periodEnd,
      hasUnresolvedPricing: false,
    };
  }

  const targetMonth =
    month && monthSchema.safeParse(month).success
      ? month
      : format(new Date(), "yyyy-MM");

  return unstable_cache(
    () => _getUserList(targetMonth),
    ["anthropic-user-list", targetMonth],
    { tags: ["anthropic-workspace-costs"] }
  )();
}

// ---------------------------------------------------------------------------
// getUsersDashboardKpis — T106
// ---------------------------------------------------------------------------

async function _getUsersDashboardKpis(month: string): Promise<UsersDashboardKpis> {
  const periodStart = `${month}-01`;
  const periodEnd = format(endOfMonth(parseISO(periodStart)), "yyyy-MM-dd");
  const priorMonthDate = subMonths(parseISO(periodStart), 1);
  const priorStart = format(startOfMonth(priorMonthDate), "yyyy-MM-dd");
  const priorEnd = format(endOfMonth(priorMonthDate), "yyyy-MM-dd");

  // Current + prior period per-user totals in a single round-trip. We need:
  //  - active user counts (cost > 0) per period for MoM
  //  - the top spender (id/name/email + cost)
  //  - the top-5 concentration ratio
  // All can be derived from the per-user totals so we keep the queries tight.
  const rows = await db.execute(sql`
    SELECT
      u.id            AS user_id,
      u.email,
      u.name,
      COALESCE(SUM(CASE WHEN m.date BETWEEN ${periodStart}::date AND ${periodEnd}::date
        THEN m.computed_cost_cents ELSE 0 END), 0)::bigint AS current_cents,
      COALESCE(SUM(CASE WHEN m.date BETWEEN ${priorStart}::date AND ${priorEnd}::date
        THEN m.computed_cost_cents ELSE 0 END), 0)::bigint AS prior_cents
    FROM users u
    LEFT JOIN anthropic_usage_metrics m
           ON m.user_id = u.id
          AND m.date BETWEEN ${priorStart}::date AND ${periodEnd}::date
    WHERE u.id <> ${LOCK_USER_ID}
    GROUP BY u.id, u.email, u.name
  `);

  const perUser = rows.rows.map((r) => ({
    userId: Number(r.user_id),
    email: r.email as string,
    name: (r.name as string | null) ?? "",
    currentCents: Number(r.current_cents ?? 0),
    priorCents: Number(r.prior_cents ?? 0),
  }));

  const activeUsersCurrent = perUser.filter((u) => u.currentCents > 0).length;
  const activeUsersPrior = perUser.filter((u) => u.priorCents > 0).length;
  const activeUsersDeltaPct = activeUserDeltaPct(activeUsersCurrent, activeUsersPrior);

  // Sort DESC by current cents for top spender + top-5 calculation.
  const sortedDesc = [...perUser].sort((a, b) => {
    if (b.currentCents !== a.currentCents) return b.currentCents - a.currentCents;
    return a.email.localeCompare(b.email);
  });
  const totalCents = sortedDesc.reduce((s, u) => s + u.currentCents, 0);

  let topSpender: UsersDashboardKpis["topSpender"] = null;
  const top = sortedDesc[0];
  if (top && top.currentCents > 0) {
    topSpender = {
      userId: top.userId,
      name: top.name,
      email: top.email,
      costCents: top.currentCents,
      pctOfOrg:
        totalCents > 0 ? Math.round((top.currentCents / totalCents) * 100) : 0,
    };
  }

  const topFiveConcentrationPct = topNConcentrationPct(
    sortedDesc.map((u) => u.currentCents),
    totalCents,
    5
  );

  // Users with no API key — bound to active users only, using the canonical
  // sentinel filter. Pulls the denominator (all active users excluding the lock)
  // in the same query for the "N / M" tile caption.
  const keyRows = await db.execute(sql`
    SELECT
      u.status,
      s.resolved_api_key_id
    FROM users u
    LEFT JOIN anthropic_sync_status s ON s.user_id = u.id
    WHERE u.id <> ${LOCK_USER_ID}
      AND u.status = 'active'
  `);
  const { numerator: usersWithNoApiKey, denominator: usersWithNoApiKeyDenominator } =
    countUsersWithNoApiKey(
      keyRows.rows.map((r) => ({
        status: r.status as UserStatus,
        hasApiKey: r.resolved_api_key_id != null,
      }))
    );

  return {
    activeUsersCurrent,
    activeUsersPrior,
    activeUsersDeltaPct,
    topSpender,
    topFiveConcentrationPct,
    usersWithNoApiKey,
    usersWithNoApiKeyDenominator,
    totalCents,
  };
}

export async function getUsersDashboardKpis(
  month?: string
): Promise<UsersDashboardKpis> {
  const admin = await requireAdmin();
  if (!admin) {
    return {
      activeUsersCurrent: 0,
      activeUsersPrior: 0,
      activeUsersDeltaPct: null,
      topSpender: null,
      topFiveConcentrationPct: null,
      usersWithNoApiKey: 0,
      usersWithNoApiKeyDenominator: 0,
      totalCents: 0,
    };
  }

  const targetMonth =
    month && monthSchema.safeParse(month).success
      ? month
      : format(new Date(), "yyyy-MM");

  return unstable_cache(
    () => _getUsersDashboardKpis(targetMonth),
    ["anthropic-users-kpis", targetMonth],
    { tags: ["anthropic-workspace-costs"] }
  )();
}

// ---------------------------------------------------------------------------
// getAvailableUserMonths — T107
// ---------------------------------------------------------------------------

async function _getAvailableUserMonths(): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT TO_CHAR(DATE_TRUNC('month', date::date), 'YYYY-MM') AS month
    FROM anthropic_usage_metrics
    ORDER BY 1 DESC
  `);
  return rows.rows.map((r) => r.month as string);
}

export async function getAvailableUserMonths(): Promise<string[]> {
  const admin = await requireAdmin();
  if (!admin) return [];
  return unstable_cache(
    _getAvailableUserMonths,
    ["anthropic-available-user-months"],
    { tags: ["anthropic-workspace-costs"] }
  )();
}
