"use server";

import { db } from "@/lib/db";
import {
  copilotUsageMetrics,
  copilotBillingSnapshots,
  licenseAssignments,
  users,
  githubProfiles,
  accessTiers,
  githubSyncEvents,
} from "@/lib/db/schema";
import { and, sql, desc, asc, gte, lte, eq, or, ilike } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-helpers";
import {
  copilotDateRangeSchema,
  copilotSeatFilterSchema,
  copilotSeatDetailSchema,
} from "@/lib/validators";
import type {
  ActionResult,
  CopilotOverviewData,
  CopilotBillingData,
  CopilotAnalyticsData,
} from "@/types";

export async function getCopilotOverview(
  input?: unknown
): Promise<ActionResult<CopilotOverviewData>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  // Parse optional date range
  const parsed = copilotDateRangeSchema.safeParse(input ?? {});
  if (!parsed.success) return { success: false, error: "Invalid date range" };

  const { since, until } = parsed.data;

  // Default to last 28 days if no range specified
  const now = new Date();
  const defaultSince = new Date(now);
  defaultSince.setDate(defaultSince.getDate() - 28);

  const sinceDate = since || defaultSince.toISOString().split("T")[0];
  const untilDate = until || now.toISOString().split("T")[0];

  // Query usage metrics for date range
  const metrics = await db
    .select()
    .from(copilotUsageMetrics)
    .where(
      and(
        gte(copilotUsageMetrics.date, sinceDate),
        lte(copilotUsageMetrics.date, untilDate)
      )
    )
    .orderBy(copilotUsageMetrics.date);

  // Query latest billing snapshot for seat counts
  const [latestBilling] = await db
    .select()
    .from(copilotBillingSnapshots)
    .orderBy(desc(copilotBillingSnapshots.billingMonth))
    .limit(1);

  // Query active copilot-sync seat count
  const [_seatCounts] = await db
    .select({
      active: sql<number>`count(*) filter (where ${licenseAssignments.status} = 'active' and ${licenseAssignments.source} = 'copilot-sync')`,
    })
    .from(licenseAssignments);

  // Aggregate totals from metrics
  let totalSuggestions = 0;
  let totalAcceptances = 0;
  let totalLinesSuggested = 0;
  let totalLinesAccepted = 0;
  let totalActiveUsers = 0;

  const trends = metrics.map((m) => {
    totalSuggestions += m.totalSuggestions;
    totalAcceptances += m.totalAcceptances;
    totalLinesSuggested += m.totalLinesSuggested;
    totalLinesAccepted += m.totalLinesAccepted;
    if (m.totalActiveUsers > totalActiveUsers) {
      totalActiveUsers = m.totalActiveUsers;
    }

    const dayRate =
      m.totalSuggestions > 0
        ? Math.round((m.totalAcceptances / m.totalSuggestions) * 100)
        : 0;

    return {
      date: m.date,
      suggestions: m.totalSuggestions,
      acceptances: m.totalAcceptances,
      activeUsers: m.totalActiveUsers,
      acceptanceRate: dayRate,
    };
  });

  const acceptanceRate =
    totalSuggestions > 0
      ? Math.round((totalAcceptances / totalSuggestions) * 100)
      : 0;

  return {
    success: true,
    data: {
      totalSeats: latestBilling?.totalSeats ?? 0,
      activeSeats: latestBilling?.activeSeats ?? 0,
      pendingSeats: 0, // Will be calculated from billing data
      acceptanceRate,
      totalSuggestions,
      totalAcceptances,
      totalLinesSuggested,
      totalLinesAccepted,
      totalActiveUsers,
      trends,
    },
  };
}

export async function getCopilotSeats(input?: unknown): Promise<
  ActionResult<{
    seats: Array<{
      githubLogin: string;
      githubId: number;
      avatarUrl: string | null;
      assignedAt: string;
      lastActivityAt: string | null;
      lastActivityEditor: string | null;
      planType: "business" | "enterprise";
      status: "active" | "inactive" | "pending";
      matchedUserId: number | null;
      matchedUserName: string | null;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }>
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = copilotSeatFilterSchema.safeParse(input ?? {});
  if (!parsed.success) return { success: false, error: "Invalid filter parameters" };

  const {
    search,
    status,
    sortBy = "assignedAt",
    sortOrder = "desc",
    page = 1,
    pageSize = 20,
  } = parsed.data;

  // Build conditions
  const conditions = [eq(licenseAssignments.source, "copilot-sync")];

  if (status) {
    conditions.push(eq(licenseAssignments.status, status === "pending" ? "active" : status));
  }

  if (search) {
    conditions.push(
      or(
        ilike(users.name, `%${search}%`),
        ilike(githubProfiles.githubLogin, `%${search}%`)
      )!
    );
  }

  // Build sort expression
  const sortColumn =
    sortBy === "name"
      ? users.name
      : sortBy === "lastActivity"
        ? licenseAssignments.assignedAt
        : licenseAssignments.assignedAt;
  const orderFn = sortOrder === "asc" ? asc : desc;

  // Count total matching rows
  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(licenseAssignments)
    .innerJoin(users, eq(licenseAssignments.userId, users.id))
    .leftJoin(githubProfiles, eq(users.id, githubProfiles.userId))
    .leftJoin(accessTiers, eq(licenseAssignments.tierId, accessTiers.id))
    .where(and(...conditions));

  const total = Number(countResult?.count ?? 0);

  // Query seats with pagination
  const rows = await db
    .select({
      assignmentId: licenseAssignments.id,
      assignedAt: licenseAssignments.assignedAt,
      assignmentStatus: licenseAssignments.status,
      userId: users.id,
      userName: users.name,
      githubLogin: githubProfiles.githubLogin,
      githubId: githubProfiles.githubId,
      avatarUrl: githubProfiles.avatarUrl,
      tierName: accessTiers.name,
    })
    .from(licenseAssignments)
    .innerJoin(users, eq(licenseAssignments.userId, users.id))
    .leftJoin(githubProfiles, eq(users.id, githubProfiles.userId))
    .leftJoin(accessTiers, eq(licenseAssignments.tierId, accessTiers.id))
    .where(and(...conditions))
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const seats = rows.map((row) => {
    const tierLower = (row.tierName ?? "").toLowerCase();
    const planType: "business" | "enterprise" = tierLower.includes("enterprise")
      ? "enterprise"
      : "business";

    return {
      githubLogin: row.githubLogin ?? "",
      githubId: row.githubId ?? 0,
      avatarUrl: row.avatarUrl ?? null,
      assignedAt: row.assignedAt.toISOString(),
      lastActivityAt: null as string | null,
      lastActivityEditor: null as string | null,
      planType,
      status: row.assignmentStatus as "active" | "inactive" | "pending",
      matchedUserId: row.userId,
      matchedUserName: row.userName,
    };
  });

  return {
    success: true,
    data: { seats, total, page, pageSize },
  };
}

export async function getCopilotSeatDetail(input: unknown): Promise<
  ActionResult<{
    githubLogin: string;
    githubId: number;
    avatarUrl: string | null;
    assignedAt: string;
    lastActivityAt: string | null;
    lastActivityEditor: string | null;
    planType: "business" | "enterprise";
    status: "active" | "inactive" | "pending";
    matchedUserId: number | null;
    matchedUserName: string | null;
    activityTimeline: Array<{ date: string; lastActivityAt: string | null; status: string }>;
  }>
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = copilotSeatDetailSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input: githubId is required" };

  const { githubId } = parsed.data;

  // Find the github profile by githubId
  const [profile] = await db
    .select()
    .from(githubProfiles)
    .where(eq(githubProfiles.githubId, githubId))
    .limit(1);

  if (!profile) return { success: false, error: "GitHub profile not found" };

  // Find the license assignment for this user where source = copilot-sync
  const [assignment] = await db
    .select({
      assignmentId: licenseAssignments.id,
      assignedAt: licenseAssignments.assignedAt,
      assignmentStatus: licenseAssignments.status,
      userId: users.id,
      userName: users.name,
      tierName: accessTiers.name,
    })
    .from(licenseAssignments)
    .innerJoin(users, eq(licenseAssignments.userId, users.id))
    .leftJoin(accessTiers, eq(licenseAssignments.tierId, accessTiers.id))
    .where(
      and(
        eq(licenseAssignments.userId, profile.userId),
        eq(licenseAssignments.source, "copilot-sync")
      )
    )
    .limit(1);

  if (!assignment) return { success: false, error: "No Copilot seat assignment found for this user" };

  // Build activity timeline from sync events (copilot sync type)
  const syncEvents = await db
    .select({
      startedAt: githubSyncEvents.startedAt,
      completedAt: githubSyncEvents.completedAt,
      status: githubSyncEvents.status,
    })
    .from(githubSyncEvents)
    .where(eq(githubSyncEvents.syncType, "copilot"))
    .orderBy(desc(githubSyncEvents.startedAt))
    .limit(30);

  const activityTimeline = syncEvents.map((evt) => ({
    date: evt.startedAt.toISOString().split("T")[0],
    lastActivityAt: evt.completedAt?.toISOString() ?? null,
    status: evt.status,
  }));

  const tierLower = (assignment.tierName ?? "").toLowerCase();
  const planType: "business" | "enterprise" = tierLower.includes("enterprise")
    ? "enterprise"
    : "business";

  return {
    success: true,
    data: {
      githubLogin: profile.githubLogin,
      githubId: profile.githubId,
      avatarUrl: profile.avatarUrl ?? null,
      assignedAt: assignment.assignedAt.toISOString(),
      lastActivityAt: null,
      lastActivityEditor: null,
      planType,
      status: assignment.assignmentStatus as "active" | "inactive" | "pending",
      matchedUserId: assignment.userId,
      matchedUserName: assignment.userName,
      activityTimeline,
    },
  };
}

export async function getCopilotBilling(
  input?: unknown
): Promise<ActionResult<CopilotBillingData>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = copilotDateRangeSchema.safeParse(input ?? {});
  if (!parsed.success) return { success: false, error: "Invalid date range" };

  const { since, until } = parsed.data;

  // Build conditions for optional date range
  const conditions = [];
  if (since) conditions.push(gte(copilotBillingSnapshots.billingMonth, since));
  if (until) conditions.push(lte(copilotBillingSnapshots.billingMonth, until));

  // Query billing snapshots ordered by month
  const snapshots = await db
    .select()
    .from(copilotBillingSnapshots)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(copilotBillingSnapshots.billingMonth));

  // Current month = latest snapshot
  const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

  // Cumulative cost
  let cumulativeCostCents = 0;
  for (const s of snapshots) {
    cumulativeCostCents += s.totalCostCents;
  }

  // Cost per active user (handle division by zero)
  const costPerActiveUserCents =
    latestSnapshot && latestSnapshot.activeSeats > 0
      ? Math.round(latestSnapshot.totalCostCents / latestSnapshot.activeSeats)
      : 0;

  // Build trends
  const trends = snapshots.map((s) => ({
    month: s.billingMonth,
    totalCostCents: s.totalCostCents,
    totalSeats: s.totalSeats,
    activeSeats: s.activeSeats,
    costPerActiveUserCents:
      s.activeSeats > 0 ? Math.round(s.totalCostCents / s.activeSeats) : 0,
  }));

  return {
    success: true,
    data: {
      currentMonth: {
        totalCostCents: latestSnapshot?.totalCostCents ?? 0,
        activeSeats: latestSnapshot?.activeSeats ?? 0,
        totalSeats: latestSnapshot?.totalSeats ?? 0,
        costPerActiveUserCents,
        planType: latestSnapshot?.planType ?? "business",
      },
      cumulativeCostCents,
      trends,
    },
  };
}

export async function getCopilotAnalytics(
  input?: unknown
): Promise<ActionResult<CopilotAnalyticsData>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = copilotDateRangeSchema.safeParse(input ?? {});
  if (!parsed.success) return { success: false, error: "Invalid date range" };

  const { since, until } = parsed.data;

  // Default to last 28 days
  const now = new Date();
  const defaultSince = new Date(now);
  defaultSince.setDate(defaultSince.getDate() - 28);

  const sinceDate = since || defaultSince.toISOString().split("T")[0];
  const untilDate = until || now.toISOString().split("T")[0];

  // Query usage metrics for date range
  const metrics = await db
    .select()
    .from(copilotUsageMetrics)
    .where(
      and(
        gte(copilotUsageMetrics.date, sinceDate),
        lte(copilotUsageMetrics.date, untilDate)
      )
    )
    .orderBy(asc(copilotUsageMetrics.date));

  // Aggregate language breakdown from JSONB across all days
  const languageMap = new Map<
    string,
    { suggestions: number; acceptances: number; linesSuggested: number; linesAccepted: number }
  >();

  for (const m of metrics) {
    const breakdown = m.languageBreakdown as unknown;
    if (Array.isArray(breakdown)) {
      for (const entry of breakdown) {
        const item = entry as Record<string, unknown>;
        const lang = String(item.language ?? item.name ?? "unknown");
        const existing = languageMap.get(lang) ?? {
          suggestions: 0,
          acceptances: 0,
          linesSuggested: 0,
          linesAccepted: 0,
        };
        existing.suggestions += Number(item.suggestions ?? item.totalSuggestions ?? 0);
        existing.acceptances += Number(item.acceptances ?? item.totalAcceptances ?? 0);
        existing.linesSuggested += Number(item.linesSuggested ?? item.totalLinesSuggested ?? 0);
        existing.linesAccepted += Number(item.linesAccepted ?? item.totalLinesAccepted ?? 0);
        languageMap.set(lang, existing);
      }
    }
  }

  const byLanguage = Array.from(languageMap.entries())
    .map(([language, data]) => ({
      language,
      suggestions: data.suggestions,
      acceptances: data.acceptances,
      acceptanceRate:
        data.suggestions > 0
          ? Math.round((data.acceptances / data.suggestions) * 100)
          : 0,
      linesSuggested: data.linesSuggested,
      linesAccepted: data.linesAccepted,
    }))
    .sort((a, b) => b.suggestions - a.suggestions);

  // Aggregate editor breakdown from JSONB across all days
  const editorMap = new Map<
    string,
    { engagedUsers: number; suggestions: number; acceptances: number }
  >();

  for (const m of metrics) {
    const breakdown = m.editorBreakdown as unknown;
    if (Array.isArray(breakdown)) {
      for (const entry of breakdown) {
        const item = entry as Record<string, unknown>;
        const editor = String(item.editor ?? item.name ?? "unknown");
        const existing = editorMap.get(editor) ?? {
          engagedUsers: 0,
          suggestions: 0,
          acceptances: 0,
        };
        existing.engagedUsers += Number(item.engagedUsers ?? item.totalEngagedUsers ?? 0);
        existing.suggestions += Number(item.suggestions ?? item.totalSuggestions ?? 0);
        existing.acceptances += Number(item.acceptances ?? item.totalAcceptances ?? 0);
        editorMap.set(editor, existing);
      }
    }
  }

  const byEditor = Array.from(editorMap.entries())
    .map(([editor, data]) => ({
      editor,
      engagedUsers: data.engagedUsers,
      suggestions: data.suggestions,
      acceptances: data.acceptances,
    }))
    .sort((a, b) => b.suggestions - a.suggestions);

  // Activity distribution: derive from latest billing + seat counts
  const [latestBilling] = await db
    .select()
    .from(copilotBillingSnapshots)
    .orderBy(desc(copilotBillingSnapshots.billingMonth))
    .limit(1);

  const totalSeats = latestBilling?.totalSeats ?? 0;
  const activeSeats = latestBilling?.activeSeats ?? 0;
  const inactiveUsers = totalSeats - activeSeats;

  const activityDistribution = {
    powerUsers: 0,
    regularUsers: activeSeats,
    occasionalUsers: 0,
    inactiveUsers: inactiveUsers >= 0 ? inactiveUsers : 0,
  };

  // Utilization trend: for each day in metrics, activeUsers vs totalSeats
  const utilizationTrend = metrics.map((m) => ({
    date: m.date,
    activeUsers: m.totalActiveUsers,
    totalSeats,
    utilizationRate:
      totalSeats > 0
        ? Math.round((m.totalActiveUsers / totalSeats) * 100)
        : 0,
  }));

  return {
    success: true,
    data: {
      byLanguage,
      byEditor,
      activityDistribution,
      utilizationTrend,
    },
  };
}
