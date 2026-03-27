/**
 * Internal (non-action) helpers for fetching profile and cost data.
 *
 * These functions perform NO session-based auth checks; callers are
 * responsible for verifying authorization before invoking them.
 *
 * This file intentionally does NOT have a "use server" directive so
 * that it cannot be invoked as a Server Action from the client.
 */

import { db } from "@/lib/db";
import {
  anthropicUsageMetrics,
  anthropicPlanConnections,
  licenseAssignments,
  aiTools,
  accessTiers,
  users,
} from "@/lib/db/schema";
import { eq, and, between, isNotNull, inArray, sql } from "drizzle-orm";
import { anthropicToolFilter } from "@/lib/anthropic-sync";
import type {
  CostData,
  ProfileData,
  DailyModelCost,
} from "@/types";

// ---------------------------------------------------------------------------
// fetchUserCostDataInternal — pure data-fetching (no session auth check)
// ---------------------------------------------------------------------------

export async function fetchUserCostDataInternal(
  userId: number,
  month?: string,
  opts?: { includePlanLabel?: boolean }
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

  // Query usage metrics for the user in the date range, filtered to active plans
  const metrics = await db
    .select({
      id: anthropicUsageMetrics.id,
      userId: anthropicUsageMetrics.userId,
      date: anthropicUsageMetrics.date,
      model: anthropicUsageMetrics.model,
      uncachedInputTokens: anthropicUsageMetrics.uncachedInputTokens,
      cacheReadInputTokens: anthropicUsageMetrics.cacheReadInputTokens,
      cacheCreationInputTokens: anthropicUsageMetrics.cacheCreationInputTokens,
      outputTokens: anthropicUsageMetrics.outputTokens,
      computedCostCents: anthropicUsageMetrics.computedCostCents,
      pricingResolved: anthropicUsageMetrics.pricingResolved,
      planConnectionId: anthropicUsageMetrics.planConnectionId,
      planLabel: anthropicPlanConnections.label,
    })
    .from(anthropicUsageMetrics)
    .innerJoin(
      anthropicPlanConnections,
      eq(anthropicUsageMetrics.planConnectionId, anthropicPlanConnections.id)
    )
    .where(
      and(
        eq(anthropicUsageMetrics.userId, userId),
        between(anthropicUsageMetrics.date, startDate, endDate),
        eq(anthropicPlanConnections.status, "active")
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

  // Determine plan label if admin requested it and there's a single plan
  let planLabel: string | undefined;
  if (opts?.includePlanLabel && metrics.length > 0) {
    const uniqueLabels = [...new Set(metrics.map((m) => m.planLabel))];
    planLabel = uniqueLabels.length === 1 ? uniqueLabels[0] : `${uniqueLabels.length} plans`;
  }

  return {
    available: true,
    monthlyTotalCents,
    dailyBreakdown,
    latestDataDate,
    hasUnresolvedPricing,
    ...(planLabel ? { planLabel } : {}),
  };
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
