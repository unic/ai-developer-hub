import { db } from "@/lib/db";
import { syncEvents, syncSourceTypeEnum, syncOperationTypeEnum } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

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
  planConnectionId?: number;
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

export async function withSyncLock(
  params: WithSyncLockParams,
  fn: (eventId: number) => Promise<SyncCounts>
): Promise<{ eventId: number }> {
  const lockKey = params.planConnectionId
    ? `${params.sourceType}:plan_${params.planConnectionId}`
    : params.sourceType;
  const lockId = hashSourceType(lockKey);

  // Try to acquire advisory lock
  const lockResult = await db.execute(
    sql`SELECT pg_try_advisory_lock(${Number(lockId)})`
  );
  const acquired = (lockResult.rows?.[0] as Record<string, unknown>)
    ?.pg_try_advisory_lock;
  if (!acquired) {
    throw new Error("Sync already in progress");
  }

  // Insert in-progress event
  const [event] = await db
    .insert(syncEvents)
    .values({
      sourceType: params.sourceType,
      operationType: params.operationType ?? "regular",
      backfillStartDate: params.backfillStartDate
        ? params.backfillStartDate.toISOString().split("T")[0]
        : null,
      triggeredBy: params.triggeredBy ?? null,
      planConnectionId: params.planConnectionId ?? null,
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

    await updateSyncEvent(event.id, {
      outcome,
      completedAt: new Date(),
      createdCount: counts.createdCount,
      updatedCount: counts.updatedCount,
      skippedCount: counts.skippedCount,
      errorCount: counts.errorCount,
      errorMessage: counts.errorMessage ?? null,
    });

    return { eventId: event.id };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err);
    await updateSyncEvent(event.id, {
      outcome: "failed",
      completedAt: new Date(),
      errorMessage: message.slice(0, 1000),
    });
    throw err;
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${Number(lockId)})`);
  }
}
