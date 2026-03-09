"use server";

import { db } from "@/lib/db";
import {
  copilotUsageMetrics,
  copilotBillingSnapshots,
  licenseAssignments,
} from "@/lib/db/schema";
import { and, sql, desc, gte, lte } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-helpers";
import { copilotDateRangeSchema } from "@/lib/validators";
import type { ActionResult, CopilotOverviewData } from "@/types";

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
