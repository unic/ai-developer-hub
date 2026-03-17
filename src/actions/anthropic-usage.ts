"use server";

import { db } from "@/lib/db";
import {
  anthropicUsageMetrics,
  licenseAssignments,
  aiTools,
  accessTiers,
  users,
} from "@/lib/db/schema";
import { eq, and, sql, between, desc, isNotNull } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-helpers";
import { auth } from "@/lib/auth";
import { syncSingleUser } from "@/lib/anthropic-sync";
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
// getUserCostData — fetch daily Anthropic API cost breakdown for a user
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

  // Determine month boundaries
  const now = new Date();
  const targetMonth =
    month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [yearStr, monthStr] = targetMonth.split("-");
  const year = parseInt(yearStr, 10);
  const mon = parseInt(monthStr, 10);

  const startDate = `${targetMonth}-01`;
  // End date: last day of the month
  const lastDay = new Date(year, mon, 0).getDate();
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
        sql`(${aiTools.vendor} ILIKE '%anthropic%' OR ${aiTools.name} ILIKE '%claude%')`
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
// getProfileData — fetch user profile with assignments and cost data
// ---------------------------------------------------------------------------

export async function getProfileData(userId: number): Promise<ProfileData> {
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

  const costData = await getUserCostData(userId);

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
// getAvailableMonths — distinct months with usage data for a user
// ---------------------------------------------------------------------------

export async function getAvailableMonths(userId: number): Promise<string[]> {
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
