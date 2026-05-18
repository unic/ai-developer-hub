"use server";

import { requireAdmin } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { unstable_cache } from "next/cache";
import { sql } from "drizzle-orm";
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
import { LOCK_USER_ID } from "@/lib/anthropic-sync";
import {
  topNConcentrationPct,
  activeUserDeltaPct,
  countUsersWithNoApiKey,
  rankUserTopMovers,
  dominantModelPerDay,
  USER_TOP_DATES_LIMIT,
  type UserMoverInput,
} from "@/lib/anthropic-users-utils";
import {
  COST_DISTRIBUTION_BUCKETS,
  bucketCents,
} from "@/lib/claude-users-buckets";
import { projectMonthEnd } from "@/lib/utils";
import type {
  UserListRow,
  UsersDashboardKpis,
  UserProfile,
  UserStatus,
  UserRole,
  UserCostDistributionBucket,
  UserSparkline,
  UserTopMover,
  DailyByUserResult,
  DailyByUserRow,
  UserDetail,
  UserModelBreakdownRow,
  UserDailyRow,
  UserTopDateRow,
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
    INNER JOIN anthropic_sync_status s
           ON s.user_id = u.id
          AND s.resolved_api_key_id IS NOT NULL
    LEFT JOIN anthropic_usage_metrics m
           ON m.user_id = u.id
          AND m.date BETWEEN ${periodStart}::date AND ${periodEnd}::date
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

  // Users with no API key — scoped to the Boost-profile cohort. Only Boost
  // users are intended to hold an Anthropic API key in this org; counting
  // every active user inflated the tile because maxed/indie/null profiles
  // legitimately don't have one. Filter is applied in SQL so the denominator
  // we report matches reality.
  const keyRows = await db.execute(sql`
    SELECT
      u.status,
      u.profile,
      s.resolved_api_key_id
    FROM users u
    LEFT JOIN anthropic_sync_status s ON s.user_id = u.id
    WHERE u.id <> ${LOCK_USER_ID}
      AND u.status = 'active'
      AND u.profile = 'boost'
  `);
  const { numerator: usersWithNoApiKey, denominator: usersWithNoApiKeyDenominator } =
    countUsersWithNoApiKey(
      keyRows.rows.map((r) => ({
        status: r.status as UserStatus,
        profile: (r.profile as UserProfile | null) ?? null,
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

// ---------------------------------------------------------------------------
// Spec 027 — Phase 2 actions
// ---------------------------------------------------------------------------

const SPARKLINE_MONTHS = 6;
const TOP_DAILY_USERS = 5;
const STACKED_OTHER_KEY = "__other__";

// ---------------------------------------------------------------------------
// getUserCostDistribution — T201
// ---------------------------------------------------------------------------

async function _getUserCostDistribution(
  month: string
): Promise<UserCostDistributionBucket[]> {
  const periodStart = `${month}-01`;
  const periodEnd = format(endOfMonth(parseISO(periodStart)), "yyyy-MM-dd");

  // One row per user with their period total. Filtered to users with a
  // resolved API key (i.e. Boost-profile users in this org) — users without
  // a key can't generate spend, so including them inflates the $0 bucket
  // with people who were never expected to be in the histogram.
  const rows = await db.execute(sql`
    SELECT
      u.id AS user_id,
      COALESCE(SUM(m.computed_cost_cents), 0)::bigint AS cents
    FROM users u
    INNER JOIN anthropic_sync_status s ON s.user_id = u.id
    LEFT JOIN anthropic_usage_metrics m
           ON m.user_id = u.id
          AND m.date BETWEEN ${periodStart}::date AND ${periodEnd}::date
    WHERE u.id <> ${LOCK_USER_ID}
      AND u.status = 'active'
      AND s.resolved_api_key_id IS NOT NULL
    GROUP BY u.id
  `);

  // Bucket in JS (rather than SQL CASE) so the boundaries live in one place.
  // `bucketCents` mirrors the SQL boundaries exactly — see claude-users-buckets.ts.
  const counts = new Map<UserCostDistributionBucket["key"], number>();
  for (const def of COST_DISTRIBUTION_BUCKETS) counts.set(def.key, 0);
  for (const r of rows.rows) {
    const cents = Number(r.cents ?? 0);
    const key = bucketCents(cents);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return COST_DISTRIBUTION_BUCKETS.map((def) => ({
    key: def.key,
    label: def.label,
    minCents: def.minCents,
    maxCents: def.maxCents,
    userCount: counts.get(def.key) ?? 0,
  }));
}

export async function getUserCostDistribution(
  month?: string
): Promise<UserCostDistributionBucket[]> {
  const admin = await requireAdmin();
  if (!admin) {
    return COST_DISTRIBUTION_BUCKETS.map((def) => ({
      key: def.key,
      label: def.label,
      minCents: def.minCents,
      maxCents: def.maxCents,
      userCount: 0,
    }));
  }

  const targetMonth =
    month && monthSchema.safeParse(month).success
      ? month
      : format(new Date(), "yyyy-MM");

  return unstable_cache(
    () => _getUserCostDistribution(targetMonth),
    ["anthropic-user-cost-distribution", targetMonth],
    { tags: ["anthropic-workspace-costs"] }
  )();
}

// ---------------------------------------------------------------------------
// getUserSparklines — T202
// ---------------------------------------------------------------------------

async function _getUserSparklines(
  monthsBack: number
): Promise<Record<number, UserSparkline[]>> {
  // One row per (user, month) for the trailing N months. Pivot in JS to keep
  // the SQL identical in shape to `getWorkspaceSparklines`.
  const rows = await db.execute(sql`
    SELECT
      m.user_id,
      to_char(date_trunc('month', m.date), 'YYYY-MM') AS month,
      COALESCE(SUM(m.computed_cost_cents), 0)::bigint AS cents
    FROM anthropic_usage_metrics m
    WHERE m.user_id <> ${LOCK_USER_ID}
      AND m.date >= (date_trunc('month', current_date) - (${monthsBack - 1} || ' months')::interval)::date
    GROUP BY m.user_id, date_trunc('month', m.date)
    ORDER BY m.user_id, 2
  `);

  const out: Record<number, UserSparkline[]> = {};
  for (const r of rows.rows) {
    const userId = Number(r.user_id);
    if (!out[userId]) out[userId] = [];
    out[userId].push({
      month: r.month as string,
      totalCents: Number(r.cents ?? 0),
    });
  }
  return out;
}

export async function getUserSparklines(
  monthsBack: number = SPARKLINE_MONTHS
): Promise<Record<number, UserSparkline[]>> {
  const admin = await requireAdmin();
  if (!admin) return {};
  const n = Number.isInteger(monthsBack) && monthsBack > 0 ? monthsBack : SPARKLINE_MONTHS;
  return unstable_cache(
    () => _getUserSparklines(n),
    ["anthropic-user-sparklines", String(n)],
    { tags: ["anthropic-workspace-costs"] }
  )();
}

// ---------------------------------------------------------------------------
// getUserTopMovers — T203
// ---------------------------------------------------------------------------

async function _getUserTopMovers(): Promise<UserTopMover[]> {
  // Same 6-month window as the workspace top-movers: oldest 3 months = prior,
  // newest 3 months = recent. Compare and rank in JS via `rankUserTopMovers`.
  const rows = await db.execute(sql`
    WITH window6 AS (
      SELECT
        m.user_id,
        date_trunc('month', m.date) AS month,
        SUM(m.computed_cost_cents)::bigint AS cents
      FROM anthropic_usage_metrics m
      WHERE m.user_id <> ${LOCK_USER_ID}
        AND m.date >= (date_trunc('month', current_date) - interval '5 months')::date
      GROUP BY m.user_id, date_trunc('month', m.date)
    ),
    classified AS (
      SELECT
        w6.user_id,
        CASE
          WHEN w6.month >= date_trunc('month', current_date) - interval '2 months' THEN 'new'
          ELSE 'old'
        END AS bucket,
        w6.cents
      FROM window6 w6
    )
    SELECT
      c.user_id,
      u.name,
      u.email,
      COALESCE(SUM(CASE WHEN c.bucket = 'new' THEN c.cents ELSE 0 END), 0)::bigint AS recent_cents,
      COALESCE(SUM(CASE WHEN c.bucket = 'old' THEN c.cents ELSE 0 END), 0)::bigint AS prior_cents
    FROM classified c
    JOIN users u ON u.id = c.user_id
    GROUP BY c.user_id, u.name, u.email
  `);

  const inputs: UserMoverInput[] = rows.rows.map((r) => ({
    userId: Number(r.user_id),
    name: (r.name as string | null) ?? "",
    email: r.email as string,
    priorCents: Number(r.prior_cents ?? 0),
    recentCents: Number(r.recent_cents ?? 0),
  }));

  return rankUserTopMovers(inputs);
}

export async function getUserTopMovers(): Promise<UserTopMover[]> {
  const admin = await requireAdmin();
  if (!admin) return [];
  return unstable_cache(_getUserTopMovers, ["anthropic-user-top-movers"], {
    tags: ["anthropic-workspace-costs"],
  })();
}

// ---------------------------------------------------------------------------
// getDailyTotalsByUser — T204
// ---------------------------------------------------------------------------

async function _getDailyTotalsByUser(month: string): Promise<DailyByUserResult> {
  const periodStart = `${month}-01`;
  const periodEnd = format(endOfMonth(parseISO(periodStart)), "yyyy-MM-dd");

  // Per-user, per-day cents for the period. Join `users` once so we can label
  // the top-5 chips in the legend without a second round-trip.
  const rows = await db.execute(sql`
    SELECT
      m.date::text AS date,
      m.user_id,
      u.name,
      u.email,
      COALESCE(SUM(m.computed_cost_cents), 0)::bigint AS cents
    FROM anthropic_usage_metrics m
    JOIN users u ON u.id = m.user_id
    WHERE m.user_id <> ${LOCK_USER_ID}
      AND m.date BETWEEN ${periodStart}::date AND ${periodEnd}::date
    GROUP BY m.date, m.user_id, u.name, u.email
  `);

  // First pass — period totals per user, so we know who lands in the top 5.
  const totals = new Map<
    number,
    { userId: number; name: string; email: string; totalCents: number }
  >();
  for (const r of rows.rows) {
    const uid = Number(r.user_id);
    const cents = Number(r.cents ?? 0);
    const ex = totals.get(uid);
    if (ex) {
      ex.totalCents += cents;
    } else {
      totals.set(uid, {
        userId: uid,
        name: (r.name as string | null) ?? "",
        email: r.email as string,
        totalCents: cents,
      });
    }
  }

  // Rank by cost DESC, tie-broken by name ASC (then email ASC for determinism).
  const ranked = Array.from(totals.values()).sort((a, b) => {
    if (b.totalCents !== a.totalCents) return b.totalCents - a.totalCents;
    const an = a.name || a.email;
    const bn = b.name || b.email;
    if (an !== bn) return an.localeCompare(bn);
    return a.email.localeCompare(b.email);
  });
  const topUserIds = new Set(ranked.slice(0, TOP_DAILY_USERS).map((u) => u.userId));
  const hasOther = ranked.length > TOP_DAILY_USERS;

  // Second pass — bucket each day-row into either its userId key or "__other__".
  const dayMap = new Map<string, DailyByUserRow>();
  for (const r of rows.rows) {
    const date = r.date as string;
    const uid = Number(r.user_id);
    const cents = Number(r.cents ?? 0);
    let row = dayMap.get(date);
    if (!row) {
      row = { date, perUser: {}, total: 0 };
      dayMap.set(date, row);
    }
    const bucketKey = topUserIds.has(uid) ? String(uid) : STACKED_OTHER_KEY;
    row.perUser[bucketKey] = (row.perUser[bucketKey] ?? 0) + cents;
    row.total += cents;
  }

  const days = Array.from(dayMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  const topUsers: DailyByUserResult["topUsers"] = ranked
    .slice(0, TOP_DAILY_USERS)
    .map((u) => ({
      key: String(u.userId),
      userId: u.userId,
      name: u.name || u.email,
      email: u.email,
      totalCents: u.totalCents,
    }));
  if (hasOther) {
    const otherTotal = ranked
      .slice(TOP_DAILY_USERS)
      .reduce((s, u) => s + u.totalCents, 0);
    topUsers.push({
      key: STACKED_OTHER_KEY,
      userId: null,
      name: "Other",
      email: null,
      totalCents: otherTotal,
    });
  }

  return { days, topUsers };
}

export async function getDailyTotalsByUser(
  month?: string
): Promise<DailyByUserResult> {
  const admin = await requireAdmin();
  if (!admin) return { days: [], topUsers: [] };

  const targetMonth =
    month && monthSchema.safeParse(month).success
      ? month
      : format(new Date(), "yyyy-MM");

  return unstable_cache(
    () => _getDailyTotalsByUser(targetMonth),
    ["anthropic-daily-by-user", targetMonth],
    { tags: ["anthropic-workspace-costs"] }
  )();
}

// ---------------------------------------------------------------------------
// Spec 027 — Phase 3 actions (per-user drill-through)
// ---------------------------------------------------------------------------

const userIdSchema = z.number().int().positive();

async function _getUserMonths(userId: number): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT to_char(date_trunc('month', date::date), 'YYYY-MM') AS month
    FROM anthropic_usage_metrics
    WHERE user_id = ${userId}
    ORDER BY 1 DESC
  `);
  return rows.rows.map((r) => r.month as string);
}

export async function getUserMonths(userId: number): Promise<string[]> {
  const admin = await requireAdmin();
  if (!admin) return [];
  const parsed = userIdSchema.safeParse(userId);
  if (!parsed.success) return [];
  if (parsed.data === LOCK_USER_ID) return [];
  return unstable_cache(
    () => _getUserMonths(parsed.data),
    ["anthropic-user-months", String(parsed.data)],
    { tags: ["anthropic-workspace-costs"] }
  )();
}

async function _getUserDetail(
  userId: number,
  month: string
): Promise<UserDetail | null> {
  // User + workspace meta. Use LEFT JOINs so a user without a resolved
  // workspace (or with no sync_status row) still surfaces.
  const userMetaRows = await db.execute(sql`
    SELECT
      u.id, u.name, u.email, u.circle, u.profile, u.status, u.role,
      s.resolved_workspace_id,
      w.name          AS workspace_name,
      w.display_color AS workspace_color
    FROM users u
    LEFT JOIN anthropic_sync_status s ON s.user_id = u.id
    LEFT JOIN anthropic_workspaces w
      ON w.workspace_id IS NOT DISTINCT FROM s.resolved_workspace_id
    WHERE u.id = ${userId}
    LIMIT 1
  `);
  const userRow = userMetaRows.rows[0];
  if (!userRow) return null;

  const periodStart = `${month}-01`;
  const periodEnd = format(endOfMonth(parseISO(periodStart)), "yyyy-MM-dd");
  const priorMonthDate = subMonths(parseISO(periodStart), 1);
  const priorStart = format(startOfMonth(priorMonthDate), "yyyy-MM-dd");
  const priorEnd = format(endOfMonth(priorMonthDate), "yyyy-MM-dd");

  // Per-day, per-model rows for the selected month. Used to build daily
  // totals, model breakdown, top dates, and the unresolved-pricing flag in
  // a single round-trip.
  const monthRows = await db.execute(sql`
    SELECT
      m.date::text AS date,
      m.model,
      m.uncached_input_tokens,
      m.cache_read_input_tokens,
      m.cache_creation_input_tokens,
      m.output_tokens,
      m.computed_cost_cents,
      m.pricing_resolved
    FROM anthropic_usage_metrics m
    WHERE m.user_id = ${userId}
      AND m.date BETWEEN ${periodStart}::date AND ${periodEnd}::date
  `);

  // Daily totals — pad missing days so charts/top-dates can iterate cleanly.
  const dailyMap = new Map<string, number>();
  const dominantInput: { date: string; model: string; cents: number }[] = [];
  const modelTotals = new Map<
    string,
    { tokensIn: number; tokensOut: number; cents: number }
  >();
  let hasUnresolvedPricing = false;

  for (const r of monthRows.rows) {
    const date = r.date as string;
    const model = r.model as string;
    const cents = Number(r.computed_cost_cents ?? 0);
    const tokIn =
      Number(r.uncached_input_tokens ?? 0) +
      Number(r.cache_read_input_tokens ?? 0) +
      Number(r.cache_creation_input_tokens ?? 0);
    const tokOut = Number(r.output_tokens ?? 0);
    if (r.pricing_resolved === false) hasUnresolvedPricing = true;

    dailyMap.set(date, (dailyMap.get(date) ?? 0) + cents);
    dominantInput.push({ date, model, cents });

    const ex = modelTotals.get(model);
    if (ex) {
      ex.tokensIn += tokIn;
      ex.tokensOut += tokOut;
      ex.cents += cents;
    } else {
      modelTotals.set(model, { tokensIn: tokIn, tokensOut: tokOut, cents });
    }
  }

  // Pad missing days so the chart x-axis stays continuous.
  const daysInMonth = getDaysInMonth(parseISO(periodStart));
  const dailyTotals: UserDailyRow[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${month}-${String(d).padStart(2, "0")}`;
    dailyTotals.push({
      date: dateKey,
      costCents: dailyMap.get(dateKey) ?? 0,
    });
  }
  const currentMonthCents = dailyTotals.reduce((s, d) => s + d.costCents, 0);

  // Model breakdown — sort by cost DESC. Percentages are of the user's own
  // total (consistent with the workspace pattern).
  const userVisibleTotal = Array.from(modelTotals.values()).reduce(
    (s, m) => s + m.cents,
    0
  );
  const modelBreakdown: UserModelBreakdownRow[] = Array.from(
    modelTotals.entries()
  )
    .map(([modelName, v]) => ({
      modelName,
      tokensIn: v.tokensIn,
      tokensOut: v.tokensOut,
      costCents: v.cents,
      pctOfUser:
        userVisibleTotal === 0 ? 0 : Math.round((v.cents / userVisibleTotal) * 100),
    }))
    .sort((a, b) => b.costCents - a.costCents);

  // Top dates — 5 highest-cost days, with the dominant model from the
  // (date, model) breakdown we already have in memory.
  const dominantMap = dominantModelPerDay(dominantInput);
  const topDates: UserTopDateRow[] = dailyTotals
    .filter((d) => d.costCents > 0)
    .sort((a, b) => b.costCents - a.costCents || a.date.localeCompare(b.date))
    .slice(0, USER_TOP_DATES_LIMIT)
    .map((d) => ({
      date: d.date,
      costCents: d.costCents,
      dominantModel: dominantMap.get(d.date) ?? null,
    }));

  // Prior month total for MoM delta.
  const priorRows = await db.execute(sql`
    SELECT COALESCE(SUM(computed_cost_cents), 0)::bigint AS cents
    FROM anthropic_usage_metrics
    WHERE user_id = ${userId}
      AND date BETWEEN ${priorStart}::date AND ${priorEnd}::date
  `);
  const priorMonthCents = Number(priorRows.rows[0]?.cents ?? 0);
  const momDeltaCents = currentMonthCents - priorMonthCents;
  // Mirror the workspace rule: suppress the % when the prior period is < $1.
  const momDeltaPct =
    priorMonthCents < 100
      ? null
      : Math.round((momDeltaCents / priorMonthCents) * 100);

  // Linear projection — for non-current months we treat the full month as
  // elapsed so the projection equals the actual total.
  const nowMonth = format(new Date(), "yyyy-MM");
  const daysElapsed =
    month === nowMonth ? Math.max(1, getDate(new Date())) : daysInMonth;
  const projectedMonthEndCents = projectMonthEnd(
    currentMonthCents,
    daysElapsed,
    daysInMonth
  );

  // Twelve-month trend (current month included). Pad missing months with 0
  // so the bar chart has a consistent x-axis when the user only has spotty
  // history.
  const twelveRows = await db.execute(sql`
    SELECT
      to_char(date_trunc('month', date), 'YYYY-MM') AS month,
      COALESCE(SUM(computed_cost_cents), 0)::bigint AS cents
    FROM anthropic_usage_metrics
    WHERE user_id = ${userId}
      AND date >= (date_trunc('month', ${periodStart}::date) - interval '11 months')::date
      AND date <= ${periodEnd}::date
    GROUP BY 1
    ORDER BY 1
  `);
  const twelveMap = new Map<string, number>();
  for (const r of twelveRows.rows) {
    twelveMap.set(r.month as string, Number(r.cents ?? 0));
  }
  const twelveMonth: { month: string; totalCents: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const m = subMonths(parseISO(periodStart), i);
    const key = format(m, "yyyy-MM");
    twelveMonth.push({ month: key, totalCents: twelveMap.get(key) ?? 0 });
  }

  const availableMonths = await _getUserMonths(userId);

  return {
    user: {
      id: Number(userRow.id),
      name: (userRow.name as string | null) ?? "",
      email: userRow.email as string,
      circle: (userRow.circle as string | null) ?? null,
      profile: (userRow.profile as UserProfile | null) ?? null,
      status: userRow.status as UserStatus,
      role: userRow.role as UserRole,
    },
    workspace: {
      workspaceId: (userRow.resolved_workspace_id as string | null) ?? null,
      name: (userRow.workspace_name as string | null) ?? null,
      displayColor: (userRow.workspace_color as string | null) ?? null,
    },
    month,
    periodStart,
    periodEnd,
    currentMonthCents,
    priorMonthCents,
    momDeltaCents,
    momDeltaPct,
    projectedMonthEndCents,
    dailyTotals,
    modelBreakdown,
    topDates,
    twelveMonth,
    hasUnresolvedPricing,
    availableMonths,
  };
}

export async function getUserDetail(
  userId: number,
  month?: string
): Promise<UserDetail | null> {
  const admin = await requireAdmin();
  if (!admin) return null;
  const parsed = userIdSchema.safeParse(userId);
  if (!parsed.success) return null;
  if (parsed.data === LOCK_USER_ID) return null;

  const targetMonth =
    month && monthSchema.safeParse(month).success
      ? month
      : format(new Date(), "yyyy-MM");

  return unstable_cache(
    () => _getUserDetail(parsed.data, targetMonth),
    ["anthropic-user-detail", String(parsed.data), targetMonth],
    { tags: ["anthropic-workspace-costs"] }
  )();
}
