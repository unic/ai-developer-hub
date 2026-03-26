import { db } from "@/lib/db";
import { syncSources, syncEvents } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import type { SyncSourceType } from "./framework";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize raw SQL timestamps to proper UTC Date objects. */
function toDate(val: Date | string): Date {
  if (val instanceof Date) return val;
  const s = String(val);
  return new Date(s.endsWith("Z") || s.includes("+") ? s : s + "Z");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncSourceRecord {
  id: number;
  sourceType: SyncSourceType;
  enabled: boolean;
  cronSchedule: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SyncEventRecord {
  id: number;
  operationType: "regular" | "backfill";
  outcome: "in_progress" | "success" | "partial" | "failed";
  startedAt: Date;
  completedAt: Date | null;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  errorMessage: string | null;
}

export interface SyncSourceWithLastEvent extends SyncSourceRecord {
  lastEvent: SyncEventRecord | null;
}

// ---------------------------------------------------------------------------
// getSyncSources — all sources with their latest event
// ---------------------------------------------------------------------------

export async function getSyncSources(): Promise<SyncSourceWithLastEvent[]> {
  // Run both queries in parallel since they are independent
  const [sources, latestEvents] = await Promise.all([
    db.select().from(syncSources),
    db.execute<{
    id: number;
    source_type: SyncSourceType;
    operation_type: "regular" | "backfill";
    outcome: "in_progress" | "success" | "partial" | "failed";
    started_at: Date;
    completed_at: Date | null;
    created_count: number;
    updated_count: number;
    skipped_count: number;
    error_count: number;
    error_message: string | null;
    }>(sql`
      SELECT DISTINCT ON (source_type)
        id, source_type, operation_type, outcome,
        started_at, completed_at,
        created_count, updated_count, skipped_count, error_count,
        error_message
      FROM sync_events
      ORDER BY source_type, started_at DESC
    `),
  ]);

  const eventMap = new Map<string, SyncEventRecord>();
  for (const row of latestEvents.rows) {
    eventMap.set(row.source_type, {
      id: row.id,
      operationType: row.operation_type,
      outcome: row.outcome,
      startedAt: toDate(row.started_at),
      completedAt: row.completed_at ? toDate(row.completed_at) : null,
      createdCount: row.created_count,
      updatedCount: row.updated_count,
      skippedCount: row.skipped_count,
      errorCount: row.error_count,
      errorMessage: row.error_message,
    });
  }

  return sources.map((source) => ({
    id: source.id,
    sourceType: source.sourceType as SyncSourceType,
    enabled: source.enabled,
    cronSchedule: source.cronSchedule,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    lastEvent: eventMap.get(source.sourceType) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// getSyncSource — single source lookup
// ---------------------------------------------------------------------------

export async function getSyncSource(
  type: SyncSourceType
): Promise<SyncSourceRecord | null> {
  const rows = await db
    .select()
    .from(syncSources)
    .where(eq(syncSources.sourceType, type))
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    id: row.id,
    sourceType: row.sourceType as SyncSourceType,
    enabled: row.enabled,
    cronSchedule: row.cronSchedule,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
