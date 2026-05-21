import { db } from "@/lib/db";
import { syncEvents } from "@/lib/db/schema";
import { and, desc, eq, ne } from "drizzle-orm";
import type { SyncSourceType } from "@/lib/sync/framework";

/**
 * Sync event read helpers for UI surfaces that need a stable legacy-status string shape.
 *
 * `getLastCompletedSyncEvent` excludes in-progress rows (use for "last sync at" KPIs);
 * `listSyncEvents` includes them (use for activity timelines / history tables that should
 * surface a running sync). Both order by `started_at DESC` to match the rest of the
 * framework (`getSyncSources`, `getSyncHistory`) and to ride the existing
 * `sync_events_source_started_idx` index.
 */
export async function getLastCompletedSyncEvent(sourceType: SyncSourceType) {
  return db.query.syncEvents.findFirst({
    where: and(
      eq(syncEvents.sourceType, sourceType),
      ne(syncEvents.outcome, "in_progress"),
    ),
    orderBy: [desc(syncEvents.startedAt)],
  });
}

export async function listSyncEvents(
  sourceType: SyncSourceType,
  limit: number,
) {
  return db
    .select({
      id: syncEvents.id,
      startedAt: syncEvents.startedAt,
      completedAt: syncEvents.completedAt,
      outcome: syncEvents.outcome,
      createdCount: syncEvents.createdCount,
      updatedCount: syncEvents.updatedCount,
      skippedCount: syncEvents.skippedCount,
      errorCount: syncEvents.errorCount,
      errorMessage: syncEvents.errorMessage,
    })
    .from(syncEvents)
    .where(eq(syncEvents.sourceType, sourceType))
    .orderBy(desc(syncEvents.startedAt))
    .limit(limit);
}

type SyncOutcome = "in_progress" | "success" | "partial" | "failed";

export type LegacySyncStatus = "completed" | "partial" | "failed" | null;
export type DisplaySyncStatus =
  | "in_progress"
  | "completed"
  | "partial"
  | "failed";

export function mapOutcomeToLegacyStatus(
  outcome: SyncOutcome | null | undefined,
): LegacySyncStatus {
  if (outcome === "success") return "completed";
  if (outcome === "partial" || outcome === "failed") return outcome;
  return null;
}

/** Like {@link mapOutcomeToLegacyStatus} but also surfaces "in_progress" for live timelines. */
export function mapOutcomeForDisplay(outcome: SyncOutcome): DisplaySyncStatus {
  return outcome === "success" ? "completed" : outcome;
}
