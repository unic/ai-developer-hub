"use server";

import { db } from "@/lib/db";
import {
  anthropicUsageMetrics,
  licenseAssignments,
  aiTools,
  accessTiers,
  users,
} from "@/lib/db/schema";
import { eq, and, sql, between, isNotNull } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-helpers";
import { auth } from "@/lib/auth";
import { syncSingleUser, runAnthropicSync, anthropicToolFilter } from "@/lib/anthropic-sync";
import { resolveModelPricing, computeCostCents } from "@/lib/anthropic-pricing";
import { revalidatePath } from "next/cache";
import { getCurrentMonth } from "@/lib/utils";
import type {
  CostData,
  ProfileData,
  ActionResult,
  DailyModelCost,
} from "@/types";

// ---------------------------------------------------------------------------
// fetchUserCostDataInternal — pure data-fetching (no session auth check)
// ---------------------------------------------------------------------------

export async function fetchUserCostDataInternal(
  userId: number,
  month?: string
): Promise<CostData> {
  // Determine month boundaries (UTC-consistent)
  const now = new Date();
  const targetMonth =
    month ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  // Validate month format: YYYY-MM with month 01–12
  const monthMatch = targetMonth.match(/^(\d{4})-(\d{2})$/);
  if (!monthMatch) {
    return {
      available: false,
      error: "Invalid month format. Expected YYYY-MM.",
      monthlyTotalCents: 0,
      dailyBreakdown: [],
      latestDataDate: null,
      hasUnresolvedPricing: false,
    };
  }
  const year = parseInt(monthMatch[1], 10);
  const mon = parseInt(monthMatch[2], 10);
  if (mon < 1 || mon > 12) {
    return {
      available: false,
      error: "Invalid month. Must be between 01 and 12.",
      monthlyTotalCents: 0,
      dailyBreakdown: [],
      latestDataDate: null,
      hasUnresolvedPricing: false,
    };
  }

  const startDate = `${targetMonth}-01`;
  // End date: last day of the month
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const endDate = `${targetMonth}-${String(lastDay).padStart(2, "0")}`;

  // Check if the user has an active Anthropic assignment with API key configured
  const [anthropicAssignment] = await db
    .select({ id: licenseAssignments.id })
    .from(licenseAssignments)
    .innerJoin(aiTools, eq(licenseAssignments.toolId, aiTools.id))
    .where(
      and(
        eq(licenseAssignments.userId, userId),
        eq(licenseAssignments.status, "active"),
        isNotNull(licenseAssignments.apiKeyEncrypted),
        anthropicToolFilter
      )
    )
    .limit(1);

  if (!anthropicAssignment) {
    return {
      available: false,
      error:
        "No Claude API key configured. Contact your administrator.",
      monthlyTotalCents: 0,
      dailyBreakdown: [],
      latestDataDate: null,
      hasUnresolvedPricing: false,
    };
  }

  // Query usage metrics for the user in the date range
  const metrics = await db
    .select()
    .from(anthropicUsageMetrics)
    .where(
      and(
        eq(anthropicUsageMetrics.userId, userId),
        between(anthropicUsageMetrics.date, startDate, endDate)
      )
    )
    .orderBy(anthropicUsageMetrics.date);

  if (metrics.length === 0) {
    return {
      available: true,
      monthlyTotalCents: 0,
      dailyBreakdown: [],
      latestDataDate: null,
      hasUnresolvedPricing: false,
    };
  }

  // Aggregate by date
  const dailyMap = new Map<
    string,
    { models: DailyModelCost[]; totalCents: number }
  >();
  let monthlyTotalCents = 0;
  let latestDataDate: string | null = null;
  let hasUnresolvedPricing = false;

  for (const row of metrics) {
    const dateStr = row.date;
    if (!latestDataDate || dateStr > latestDataDate) {
      latestDataDate = dateStr;
    }
    if (!row.pricingResolved) {
      hasUnresolvedPricing = true;
    }

    const inputTokens =
      row.uncachedInputTokens +
      row.cacheReadInputTokens +
      row.cacheCreationInputTokens;

    const modelEntry: DailyModelCost = {
      model: row.model,
      costCents: row.computedCostCents,
      inputTokens,
      outputTokens: row.outputTokens,
    };

    const existing = dailyMap.get(dateStr);
    if (existing) {
      existing.models.push(modelEntry);
      existing.totalCents += row.computedCostCents;
    } else {
      dailyMap.set(dateStr, {
        models: [modelEntry],
        totalCents: row.computedCostCents,
      });
    }

    monthlyTotalCents += row.computedCostCents;
  }

  const dailyBreakdown = Array.from(dailyMap.entries())
    .map(([date, data]) => ({
      date,
      models: data.models,
      totalCents: data.totalCents,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    available: true,
    monthlyTotalCents,
    dailyBreakdown,
    latestDataDate,
    hasUnresolvedPricing,
  };
}

// ---------------------------------------------------------------------------
// getUserCostData — session-authenticated wrapper around fetchUserCostDataInternal
// ---------------------------------------------------------------------------

export async function getUserCostData(
  userId: number,
  month?: string
): Promise<CostData> {
  // Auth check: caller must be the same user or an admin
  const session = await auth();
  if (!session?.user) {
    return {
      available: false,
      error: "Unauthorized — not signed in.",
      monthlyTotalCents: 0,
      dailyBreakdown: [],
      latestDataDate: null,
      hasUnresolvedPricing: false,
    };
  }
  const callerId = Number(session.user.id);
  if (callerId !== userId && session.user.role !== "admin") {
    return {
      available: false,
      error: "Unauthorized — you can only view your own cost data.",
      monthlyTotalCents: 0,
      dailyBreakdown: [],
      latestDataDate: null,
      hasUnresolvedPricing: false,
    };
  }

  return fetchUserCostDataInternal(userId, month);
}

// ---------------------------------------------------------------------------
// fetchProfileDataInternal — pure data-fetching (no session auth check)
// ---------------------------------------------------------------------------

export async function fetchProfileDataInternal(
  userId: number,
  month?: string
): Promise<ProfileData> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }

  // Fetch active assignments with tool and tier info
  const assignments = await db
    .select({
      id: licenseAssignments.id,
      toolName: aiTools.name,
      tierName: accessTiers.name,
      assignedAt: licenseAssignments.assignedAt,
      status: licenseAssignments.status,
    })
    .from(licenseAssignments)
    .innerJoin(aiTools, eq(licenseAssignments.toolId, aiTools.id))
    .innerJoin(accessTiers, eq(licenseAssignments.tierId, accessTiers.id))
    .where(
      and(
        eq(licenseAssignments.userId, userId),
        eq(licenseAssignments.status, "active")
      )
    );

  const costData = await fetchUserCostDataInternal(userId, month);

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role as "admin" | "viewer",
      circle: user.circle,
      profile: user.profile as "boost" | "maxed" | "indie" | null,
    },
    assignments: assignments.map((a) => ({
      id: a.id,
      toolName: a.toolName,
      tierName: a.tierName,
      assignedAt: a.assignedAt,
      status: a.status as "active" | "inactive",
    })),
    costData,
  };
}

// ---------------------------------------------------------------------------
// getProfileData — session-authenticated wrapper around fetchProfileDataInternal
// ---------------------------------------------------------------------------

export async function getProfileData(userId: number): Promise<ProfileData> {
  // Auth check: caller must be the same user or an admin
  const session = await auth();
  if (!session?.user) {
    throw new Error("Unauthorized — not signed in.");
  }
  const callerId = Number(session.user.id);
  if (callerId !== userId && session.user.role !== "admin") {
    throw new Error("Unauthorized — you can only view your own profile.");
  }

  return fetchProfileDataInternal(userId);
}

// ---------------------------------------------------------------------------
// getAvailableMonths — distinct months with usage data for a user
// ---------------------------------------------------------------------------

export async function getAvailableMonths(userId: number): Promise<string[]> {
  // Auth check: caller must be the same user or an admin
  const session = await auth();
  if (!session?.user) return [];
  const callerId = Number(session.user.id);
  if (callerId !== userId && session.user.role !== "admin") return [];

  const monthRows = await db
    .selectDistinct({
      month: sql<string>`TO_CHAR(${anthropicUsageMetrics.date}, 'YYYY-MM')`,
    })
    .from(anthropicUsageMetrics)
    .where(eq(anthropicUsageMetrics.userId, userId))
    .orderBy(sql`TO_CHAR(${anthropicUsageMetrics.date}, 'YYYY-MM') DESC`);

  const months = monthRows.map((r) => r.month);
  const currentMonth = getCurrentMonth();
  if (!months.includes(currentMonth)) {
    months.unshift(currentMonth);
  }
  return months;
}

// ---------------------------------------------------------------------------
// syncAnthropicUsage — admin-only manual sync for a single user
// ---------------------------------------------------------------------------

export async function syncAnthropicUsage(
  userId: number
): Promise<ActionResult<{ syncedDays: number; latestDate: string | null }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  try {
    const result = await syncSingleUser(userId);

    revalidatePath(`/users/${userId}`);

    return {
      success: true,
      data: result,
    };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to sync Anthropic usage data",
    };
  }
}

// ---------------------------------------------------------------------------
// syncAllAnthropicUsage — admin-only manual sync for all users
// ---------------------------------------------------------------------------

export async function syncAllAnthropicUsage(): Promise<
  ActionResult<{
    syncedUsers: number;
    skippedUsers: number;
    syncedDays: number;
    errorCount: number;
    firstError: string | null;
  }>
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  try {
    const summary = await runAnthropicSync();

    revalidatePath("/users");

    return {
      success: true,
      data: {
        syncedUsers: summary.syncedUsers,
        skippedUsers: summary.skippedUsers,
        syncedDays: summary.syncedDays,
        errorCount: summary.errors.length,
        firstError: summary.errors[0]?.error ?? null,
      },
    };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to sync Anthropic usage data",
    };
  }
}

// ---------------------------------------------------------------------------
// recalculateUnresolvedCosts — admin-only repricing of unresolved rows
// ---------------------------------------------------------------------------

export async function recalculateUnresolvedCosts(): Promise<
  ActionResult<{ updatedRows: number; stillUnresolved: number }>
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  try {
    // Fetch all rows where pricing was not resolved
    const unresolvedRows = await db
      .select()
      .from(anthropicUsageMetrics)
      .where(eq(anthropicUsageMetrics.pricingResolved, false));

    let updatedRows = 0;
    let stillUnresolved = 0;

    for (const row of unresolvedRows) {
      const { pricing, resolved } = resolveModelPricing(row.model);
      const newCostCents = computeCostCents(
        {
          uncachedInputTokens: row.uncachedInputTokens,
          cacheReadInputTokens: row.cacheReadInputTokens,
          cacheCreationInputTokens: row.cacheCreationInputTokens,
          outputTokens: row.outputTokens,
        },
        pricing
      );

      await db
        .update(anthropicUsageMetrics)
        .set({
          computedCostCents: newCostCents,
          pricingResolved: resolved,
          updatedAt: new Date(),
        })
        .where(eq(anthropicUsageMetrics.id, row.id));

      if (resolved) {
        updatedRows++;
      } else {
        stillUnresolved++;
      }
    }

    return {
      success: true,
      data: { updatedRows, stillUnresolved },
    };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to recalculate unresolved costs",
    };
  }
}
