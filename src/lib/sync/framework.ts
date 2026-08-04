import { db } from "@/lib/db";
import { syncEvents, syncSourceTypeEnum, syncOperationTypeEnum } from "@/lib/db/schema";
import { and, eq, lt, or, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types — derived from schema enums
// ---------------------------------------------------------------------------

export type SyncSourceType = (typeof syncSourceTypeEnum.enumValues)[number];
export type SyncOperationType = (typeof syncOperationTypeEnum.enumValues)[number];

/** Human-readable labels for each sync source */
export const SOURCE_LABELS: Record<SyncSourceType, string> = {
  github_copilot_billing: "GitHub Copilot Billing",
  anthropic_api_usage: "Anthropic API Usage",
  anthropic_team_invoices: "Claude Team Invoices",
  github_members: "GitHub Members",
  invoice_period_matching: "Invoice-Period Matching",
  anthropic_api_costs: "Anthropic API Costs",
};

/** Source types that support historical backfill */
export const BACKFILL_SOURCES: SyncSourceType[] = [
  "github_copilot_billing",
  "anthropic_api_usage",
  "anthropic_api_costs",
];

export interface SyncCounts {
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  errorMessage?: string | null;
}

export interface WithSyncLockParams {
  sourceType: SyncSourceType;
  triggeredBy?: number;
  operationType?: SyncOperationType;
  backfillStartDate?: Date;
}

// ---------------------------------------------------------------------------
// hashSourceType — FNV-32 hash to advisory lock ID
// ---------------------------------------------------------------------------

export function hashSourceType(sourceType: string): bigint {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < sourceType.length; i++) {
    hash ^= sourceType.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
    hash = hash >>> 0; // Ensure unsigned 32-bit
  }
  return BigInt(hash);
}

// ---------------------------------------------------------------------------
// retryWithBackoff — exponential backoff + jitter
// ---------------------------------------------------------------------------

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts?: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  }
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 3;
  const baseDelay = opts?.baseDelayMs ?? 1000;
  const maxDelay = opts?.maxDelayMs ?? 8000;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries) break;
      const delay = Math.min(Math.pow(2, attempt) * baseDelay, maxDelay);
      const jitter = Math.floor(Math.random() * 500);
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// updateSyncEvent — patch a sync event row
// ---------------------------------------------------------------------------

export async function updateSyncEvent(
  id: number,
  patch: Partial<{
    outcome: "in_progress" | "success" | "partial" | "failed";
    completedAt: Date;
    createdCount: number;
    updatedCount: number;
    skippedCount: number;
    errorCount: number;
    errorMessage: string | null;
  }>
): Promise<void> {
  await db.update(syncEvents).set(patch).where(eq(syncEvents.id, id));
}

// ---------------------------------------------------------------------------
// withSyncLock — advisory lock + event lifecycle
// ---------------------------------------------------------------------------

/**
 * The platform ceiling that bounds every sync entrypoint, in seconds.
 *
 * Mirrors `export const maxDuration` on the three cron routes and on the
 * `/settings/sync` segment that dispatches the manual trigger + backfill server
 * actions. Kept here so the reaper's safety margin below is expressed against
 * the thing that actually bounds a run, rather than as a bare number.
 */
const SYNC_MAX_DURATION_SECONDS = 300;

/**
 * How long an `in_progress` row of each operation type may sit before it is
 * treated as abandoned.
 *
 * The invariant: a cutoff MUST exceed the longest a live run of that type can
 * possibly take, so the sweep can never terminate a row that is still being
 * written. Every entrypoint is bounded by SYNC_MAX_DURATION_SECONDS, so these
 * carry a large multiple of that ceiling rather than sitting just above it.
 *
 * Backfills are separated out deliberately: they iterate per day (Copilot) or
 * per 31-day window (Anthropic) with external API calls per step, so they are
 * the runs most likely to grow if that ceiling is ever raised. Sharing a single
 * cutoff would make "raise maxDuration" silently able to start reaping live
 * backfills.
 */
export const STALE_EVENT_AFTER_MS: Record<SyncOperationType, number> = {
  regular: 60 * 60 * 1000, // 1h — 12x the ceiling
  backfill: 6 * 60 * 60 * 1000, // 6h — 72x the ceiling
};

/** Exported for the invariant test; see STALE_EVENT_AFTER_MS. */
export const SYNC_MAX_DURATION_MS = SYNC_MAX_DURATION_SECONDS * 1000;

/**
 * Terminate `in_progress` rows that no live run can still own.
 *
 * A sync whose process is killed mid-run (function timeout, instance eviction,
 * a connection fault before the catch block lands) leaves its row at
 * `in_progress` forever. That row is not merely cosmetic: the sync dashboard
 * treats any `in_progress` source as reason to poll `getSyncStatus()` every 5s,
 * so a single stranded row turns every open admin tab into permanent database
 * load. Sweeping on every attempt keeps the cleanup unconditional rather than
 * dependent on a later run of the same source succeeding.
 */
async function reapAbandonedEvents(sourceType: SyncSourceType): Promise<void> {
  const now = Date.now();
  await db
    .update(syncEvents)
    .set({
      outcome: "failed",
      completedAt: new Date(),
      errorMessage: "Abandoned — no completion recorded before the stale cutoff",
    })
    .where(
      and(
        eq(syncEvents.sourceType, sourceType),
        eq(syncEvents.outcome, "in_progress"),
        // Per-operation cutoffs — a long backfill must not be reaped on the
        // schedule that suits a regular hourly run.
        or(
          and(
            eq(syncEvents.operationType, "regular"),
            lt(
              syncEvents.startedAt,
              new Date(now - STALE_EVENT_AFTER_MS.regular)
            )
          ),
          and(
            eq(syncEvents.operationType, "backfill"),
            lt(
              syncEvents.startedAt,
              new Date(now - STALE_EVENT_AFTER_MS.backfill)
            )
          )
        )
      )
    );
}

export async function withSyncLock(
  params: WithSyncLockParams,
  fn: (eventId: number) => Promise<SyncCounts>
): Promise<{ eventId: number }> {
  const lockId = hashSourceType(params.sourceType);

  // Unconditional, and before the lock: a stranded row must be cleared even on
  // attempts that go on to lose the race below.
  try {
    await reapAbandonedEvents(params.sourceType);
  } catch (reapErr) {
    console.error(`[sync] failed to reap abandoned ${params.sourceType} events:`, reapErr);
  }

  // NOTE: this advisory lock is not load-bearing against Neon's pooled
  // endpoint. PgBouncer runs in transaction mode, where Neon documents
  // session-level advisory locks as unsupported — successive statements can
  // land on different backends, so the unlock below may release nothing and
  // the acquire may even succeed re-entrantly on a session that already holds
  // it. Replacing this with a TTL row lease needs a migration and is tracked
  // as follow-up work (see specs/044). Until then the goal here is narrower:
  // never leak silently, and never let lock bookkeeping mask a real error.
  const lockResult = await db.execute(
    sql`SELECT pg_try_advisory_lock(${Number(lockId)})`
  );
  const acquired = (lockResult.rows?.[0] as Record<string, unknown>)
    ?.pg_try_advisory_lock;
  if (!acquired) {
    throw new Error("Sync already in progress");
  }

  try {
    // Inside the try: if this insert throws, the finally still releases the
    // lock. Previously it sat between acquire and try, so a failure here
    // stranded the lock with no release path at all.
    const [event] = await db
      .insert(syncEvents)
      .values({
        sourceType: params.sourceType,
        operationType: params.operationType ?? "regular",
        backfillStartDate: params.backfillStartDate
          ? params.backfillStartDate.toISOString().split("T")[0]
          : null,
        triggeredBy: params.triggeredBy ?? null,
      })
      .returning({ id: syncEvents.id });

    try {
      const counts = await fn(event.id);

      // Determine outcome
      const outcome =
        counts.errorCount > 0 && counts.createdCount + counts.updatedCount > 0
          ? "partial"
          : counts.errorCount > 0
            ? "failed"
            : "success";

      // Best-effort: the sync itself already succeeded and its data is
      // written. If this status write fails (typically on a dead connection),
      // recording that must not convert a completed run into a thrown failure
      // — the reaper above will terminate the row on the next attempt.
      try {
        await updateSyncEvent(event.id, {
          outcome,
          completedAt: new Date(),
          createdCount: counts.createdCount,
          updatedCount: counts.updatedCount,
          skippedCount: counts.skippedCount,
          errorCount: counts.errorCount,
          errorMessage: counts.errorMessage ?? null,
        });
      } catch (bookkeepingErr) {
        console.error(
          `[sync] ${params.sourceType} succeeded but recording event ${event.id} failed:`,
          bookkeepingErr
        );
      }

      return { eventId: event.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Same reasoning inverted: a failure to record the failure must never
      // replace the original error, which is the one worth surfacing.
      try {
        await updateSyncEvent(event.id, {
          outcome: "failed",
          completedAt: new Date(),
          errorMessage: message.slice(0, 1000),
        });
      } catch (bookkeepingErr) {
        console.error(
          `[sync] failed to mark event ${event.id} as failed:`,
          bookkeepingErr
        );
      }
      throw err;
    }
  } finally {
    // Total: an unlock that throws must not replace the error being propagated.
    try {
      const releaseResult = await db.execute(
        sql`SELECT pg_advisory_unlock(${Number(lockId)})`
      );
      const released = (releaseResult.rows?.[0] as Record<string, unknown>)
        ?.pg_advisory_unlock;
      if (released === false) {
        console.error(
          `[sync] advisory unlock was a no-op for ${params.sourceType} — the ` +
            `lock was taken on a different backend session and is now leaked`
        );
      }
    } catch (unlockErr) {
      console.error(
        `[sync] advisory unlock threw for ${params.sourceType}:`,
        unlockErr
      );
    }
  }
}
