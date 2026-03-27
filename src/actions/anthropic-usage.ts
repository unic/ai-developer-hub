"use server";

import { db } from "@/lib/db";
import {
  anthropicUsageMetrics,
  syncEvents,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-helpers";
import { auth } from "@/lib/auth";
import { syncSingleUser, anthropicToolFilter } from "@/lib/anthropic-sync";
import { run as runAnthropicUsageSource } from "@/lib/sync/sources/anthropic-usage";
import { resolveModelPricing, computeCostCents } from "@/lib/anthropic-pricing";
import { revalidatePath } from "next/cache";
import { getCurrentMonth } from "@/lib/utils";
import {
  fetchUserCostDataInternal,
  fetchProfileDataInternal,
} from "@/lib/profile-data";
import type {
  CostData,
  ProfileData,
  ActionResult,
} from "@/types";

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

  const isAdmin = session.user.role === "admin";
  return fetchUserCostDataInternal(userId, month, {
    includePlanLabel: isAdmin && callerId !== userId,
  });
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
    const { eventId } = await runAnthropicUsageSource(Number(admin.id));

    // Read actual counts from the completed sync event
    const event = await db.query.syncEvents.findFirst({
      where: eq(syncEvents.id, eventId),
    });

    revalidatePath("/users");

    return {
      success: true,
      data: {
        syncedUsers: event?.createdCount ?? 0,
        skippedUsers: event?.skippedCount ?? 0,
        syncedDays: event?.updatedCount ?? 0,
        errorCount: event?.errorCount ?? 0,
        firstError: event?.errorMessage ?? null,
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
// syncAllAnthropicUsageForPlan — admin-only manual sync for a specific plan
// ---------------------------------------------------------------------------

export async function syncAllAnthropicUsageForPlan(
  planConnectionId: number
): Promise<
  ActionResult<{ eventId: number }>
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  try {
    const { eventId } = await runAnthropicUsageSource(Number(admin.id), {
      planConnectionId,
    });

    revalidatePath("/settings/integrations");
    return { success: true, data: { eventId } };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to sync Anthropic usage data for plan",
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

