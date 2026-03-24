"use server";

import { requireAdmin } from "@/lib/auth-helpers";
import { getSyncSources, getSyncSource } from "@/lib/sync/registry";
import { BACKFILL_SOURCES, type SyncSourceType } from "@/lib/sync/framework";
import { db } from "@/lib/db";
import { syncEvents, users } from "@/lib/db/schema";
import { desc, eq, isNull, isNotNull, and } from "drizzle-orm";
import { z } from "zod";
import type { SyncSourceWithLastEvent } from "@/lib/sync/registry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SyncActionResult =
  | { success: true; eventId: number }
  | { success: false; error: string };

type SyncStatusResult =
  | { success: true; data: SyncSourceWithLastEvent[] }
  | { success: false; error: string };

export type SyncEventRow = {
  id: number;
  sourceType: SyncSourceType;
  operationType: "regular" | "backfill";
  outcome: "in_progress" | "success" | "partial" | "failed";
  startedAt: Date;
  completedAt: Date | null;
  triggeredBy: { id: number; name: string } | null;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  errorMessage: string | null;
};

type SyncHistoryOptions = {
  triggerType: "scheduled" | "manual";
  limit?: number;
  sourceType?: SyncSourceType;
};

type SyncHistoryResult =
  | { success: true; data: SyncEventRow[] }
  | { success: false; error: string };

async function getSourceRunner(sourceType: SyncSourceType) {
  switch (sourceType) {
    case "github_copilot_billing":
      return (await import("@/lib/sync/sources/github-copilot")).run;
    case "anthropic_api_usage":
      return (await import("@/lib/sync/sources/anthropic-usage")).run;
    case "github_members":
      return (await import("@/lib/sync/sources/github-members")).run;
    case "invoice_period_matching":
      return (await import("@/lib/sync/sources/invoice-matching")).run;
    case "anthropic_api_costs":
      return (await import("@/lib/sync/sources/anthropic-workspace")).run;
    case "anthropic_team_invoices":
      // Team invoices are ingested via POST /api/invoices/ingest, not via sync
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// triggerSync — manually trigger a regular sync
// ---------------------------------------------------------------------------

export async function triggerSync(
  sourceType: SyncSourceType
): Promise<SyncActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const source = await getSyncSource(sourceType);
  if (!source || !source.enabled) {
    return { success: false, error: "Source not found or disabled" };
  }

  const runner = await getSourceRunner(sourceType);
  if (!runner) {
    return {
      success: false,
      error: "This source does not support manual triggering",
    };
  }

  try {
    const result = await runner(Number(admin.id));
    return { success: true, eventId: result.eventId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// triggerBackfill — historical data import
// ---------------------------------------------------------------------------

const backfillSchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format")
    .refine((d) => !isNaN(Date.parse(d)), "Invalid date"),
});

export async function triggerBackfill(
  sourceType: SyncSourceType,
  startDate: string
): Promise<SyncActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  if (!BACKFILL_SOURCES.includes(sourceType)) {
    return { success: false, error: "Backfill not supported for this source" };
  }

  const parsed = backfillSchema.safeParse({ startDate });
  if (!parsed.success) {
    return { success: false, error: "Invalid start date format (YYYY-MM-DD)" };
  }

  const parsedDate = new Date(parsed.data.startDate);
  const now = new Date();

  if (parsedDate > now) {
    return { success: false, error: "Start date cannot be in the future" };
  }

  const twentyFourMonthsAgo = new Date(now);
  twentyFourMonthsAgo.setMonth(twentyFourMonthsAgo.getMonth() - 24);
  if (parsedDate < twentyFourMonthsAgo) {
    return {
      success: false,
      error: "Start date cannot be more than 24 months ago",
    };
  }

  const source = await getSyncSource(sourceType);
  if (!source || !source.enabled) {
    return { success: false, error: "Source not found or disabled" };
  }

  const runner = await getSourceRunner(sourceType);
  if (!runner) {
    return { success: false, error: "Source runner not available" };
  }

  try {
    const result = await runner(Number(admin.id), {
      backfillStartDate: parsedDate,
    });
    return { success: true, eventId: result.eventId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// getSyncStatus — all sources with latest events
// ---------------------------------------------------------------------------

export async function getSyncStatus(): Promise<SyncStatusResult> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  try {
    const sources = await getSyncSources();
    return { success: true, data: sources };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// getSyncHistory — paginated history of sync events
// ---------------------------------------------------------------------------

export async function getSyncHistory(
  options: SyncHistoryOptions
): Promise<SyncHistoryResult> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const { triggerType, limit = 50, sourceType } = options;

  try {
    const conditions = [
      triggerType === "scheduled"
        ? isNull(syncEvents.triggeredBy)
        : isNotNull(syncEvents.triggeredBy),
    ];

    if (sourceType) {
      conditions.push(eq(syncEvents.sourceType, sourceType));
    }

    const rows = await db
      .select({
        id: syncEvents.id,
        sourceType: syncEvents.sourceType,
        operationType: syncEvents.operationType,
        outcome: syncEvents.outcome,
        startedAt: syncEvents.startedAt,
        completedAt: syncEvents.completedAt,
        triggeredById: syncEvents.triggeredBy,
        createdCount: syncEvents.createdCount,
        updatedCount: syncEvents.updatedCount,
        skippedCount: syncEvents.skippedCount,
        errorCount: syncEvents.errorCount,
        errorMessage: syncEvents.errorMessage,
        userName: users.name,
      })
      .from(syncEvents)
      .leftJoin(users, eq(syncEvents.triggeredBy, users.id))
      .where(and(...conditions))
      .orderBy(desc(syncEvents.startedAt))
      .limit(limit);

    const data: SyncEventRow[] = rows.map((row) => ({
      id: row.id,
      sourceType: row.sourceType as SyncSourceType,
      operationType: row.operationType as SyncEventRow["operationType"],
      outcome: row.outcome as SyncEventRow["outcome"],
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      triggeredBy:
        row.triggeredById != null
          ? { id: row.triggeredById, name: row.userName ?? "Unknown" }
          : null,
      createdCount: row.createdCount,
      updatedCount: row.updatedCount,
      skippedCount: row.skippedCount,
      errorCount: row.errorCount,
      errorMessage: row.errorMessage,
    }));

    return { success: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
