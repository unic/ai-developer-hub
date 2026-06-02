import { db } from "@/lib/db";
import {
  anthropicUsageMetrics,
  anthropicSyncStatus,
  licenseAssignments,
  aiTools,
} from "@/lib/db/schema";
import { eq, and, sql, desc, isNotNull, inArray } from "drizzle-orm";
import { decryptApiKey } from "@/lib/crypto";
import { fetchOrgApiKeys, resolveApiKeyId } from "@/lib/anthropic-keys";
import {
  resolveModelPricing,
  computeCostCents,
} from "@/lib/anthropic-pricing";
import { ANTHROPIC_API_VERSION } from "@/lib/anthropic-constants";
import { z } from "zod";
import { env } from "@/lib/env";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LOCK_USER_ID = 0;
const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — stale lock threshold
const LOCK_COOLDOWN_MS = 60 * 1000; // 60 seconds — minimum between syncs
const DEFAULT_BACKFILL_DAYS = 31;
const MAX_HOURLY_BUCKETS = 168; // 24h × 7d — Anthropic API limit for 1h buckets

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncSummary {
  syncedUsers: number;
  skippedUsers: number;
  syncedDays: number;
  errors: Array<{ userId: number; error: string }>;
}

// Zod schema for Anthropic usage_report response
const usageBucketResultSchema = z.object({
  model: z.string().nullable().optional(),
  api_key_id: z.string().nullable().optional(),
  uncached_input_tokens: z.number().default(0),
  cache_read_input_tokens: z.number().default(0),
  cache_creation: z
    .object({
      ephemeral_5m_input_tokens: z.number().default(0),
      ephemeral_1h_input_tokens: z.number().default(0),
    })
    .nullable()
    .optional()
    .default({ ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }),
  output_tokens: z.number().default(0),
});

const usageBucketSchema = z.object({
  starting_at: z.string(),
  ending_at: z.string(),
  results: z.array(usageBucketResultSchema),
});

const usageReportResponseSchema = z.object({
  data: z.array(usageBucketSchema),
  has_more: z.boolean(),
  next_page: z.string().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Shared: SQL condition for Anthropic tool matching
// ---------------------------------------------------------------------------

/** SQL filter for license_assignments joined with ai_tools that match Anthropic/Claude tools */
export const anthropicToolFilter = sql`(${aiTools.vendor} ILIKE '%anthropic%' OR ${aiTools.name} ILIKE '%claude%')`;

// ---------------------------------------------------------------------------
// Helper: fetch usage from Anthropic Admin API
// ---------------------------------------------------------------------------

export async function fetchAnthropicUsage(
  startingAt: string,
  endingAt: string,
  apiKeyIds?: string[],
  bucketWidth: "1d" | "1h" = "1d"
): Promise<z.infer<typeof usageReportResponseSchema>> {
  const adminKey = env.ANTHROPIC_ADMIN_API_KEY;
  if (!adminKey) throw new Error("ANTHROPIC_ADMIN_API_KEY is not set");

  // Build query string manually — URLSearchParams encodes [] as %5B%5D
  // which the Anthropic API does not recognise for array parameters.
  const limit = bucketWidth === "1h" ? MAX_HOURLY_BUCKETS : DEFAULT_BACKFILL_DAYS;
  const parts = [
    `starting_at=${encodeURIComponent(startingAt)}`,
    `ending_at=${encodeURIComponent(endingAt)}`,
    `bucket_width=${bucketWidth}`,
    "group_by[]=model",
    "group_by[]=api_key_id",
    `limit=${limit}`,
  ];

  if (apiKeyIds) {
    for (const id of apiKeyIds) {
      parts.push(`api_key_ids[]=${encodeURIComponent(id)}`);
    }
  }

  const baseUrl = "https://api.anthropic.com/v1/organizations/usage_report/messages";
  const baseQuery = parts.join("&");
  let nextPageToken: string | null = null;
  const allData: z.infer<typeof usageBucketSchema>[] = [];

  do {
    const query = nextPageToken
      ? `${baseQuery}&page=${encodeURIComponent(nextPageToken)}`
      : baseQuery;

    const res = await fetch(`${baseUrl}?${query}`, {
      headers: {
        "x-api-key": adminKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${body}`);
    }

    const page = usageReportResponseSchema.parse(await res.json());
    allData.push(...page.data);

    nextPageToken = page.has_more && page.next_page ? page.next_page : null;
  } while (nextPageToken);

  return { data: allData, has_more: false, next_page: null };
}

// ---------------------------------------------------------------------------
// Helper: resolve all api_key_id → userId mappings
// ---------------------------------------------------------------------------

export async function resolveAllMappings(): Promise<Map<string, number>> {
  const mapping = new Map<string, number>();

  // Get existing cached mappings
  const existing = await db.query.anthropicSyncStatus.findMany({
    where: isNotNull(anthropicSyncStatus.resolvedApiKeyId),
  });
  for (const row of existing) {
    if (row.resolvedApiKeyId) {
      mapping.set(row.resolvedApiKeyId, row.userId);
    }
  }

  // Find all users with Anthropic API keys
  const usersWithKeys = await db
    .select({
      userId: licenseAssignments.userId,
      apiKeyEncrypted: licenseAssignments.apiKeyEncrypted,
      keyUpdatedAt: licenseAssignments.updatedAt,
    })
    .from(licenseAssignments)
    .innerJoin(aiTools, eq(licenseAssignments.toolId, aiTools.id))
    .where(
      and(
        eq(licenseAssignments.status, "active"),
        isNotNull(licenseAssignments.apiKeyEncrypted),
        anthropicToolFilter
      )
    );

  // Build a set of existing sync status rows with their timestamps for staleness check
  const existingSyncMap = new Map(
    existing.map((row) => [row.userId, row])
  );

  // Re-resolve if: no cached mapping, or the assignment was updated after the last resolve
  const needsResolve = usersWithKeys.filter((u) => {
    if (!mapping.has(u.userId.toString()) && !Array.from(mapping.values()).includes(u.userId)) {
      // No cached mapping for this user
      return true;
    }
    // Check if key was updated since we last resolved
    const syncRow = existingSyncMap.get(u.userId);
    if (syncRow?.resolvedApiKeyId && u.keyUpdatedAt > (syncRow.lastSyncCompletedAt ?? new Date(0))) {
      return true;
    }
    return false;
  });
  const mappedUserIds = new Set(mapping.values());
  const unmapped = needsResolve;

  if (unmapped.length > 0) {
    // Fetch org API keys to resolve
    const orgKeys = await fetchOrgApiKeys();

    for (const u of unmapped) {
      if (!u.apiKeyEncrypted) continue;
      try {
        const decrypted = await decryptApiKey(u.apiKeyEncrypted);
        const apiKeyId = resolveApiKeyId(decrypted, orgKeys);
        if (apiKeyId) {
          mapping.set(apiKeyId, u.userId);
          // Look up the workspace_id of the matched org key. Anthropic returns
          // null for keys in the default workspace — preserve that as SQL NULL.
          const orgKey = orgKeys.find((k) => k.id === apiKeyId);
          const workspaceId = orgKey?.workspace_id ?? null;
          // Upsert sync status with resolved ID + workspace_id
          await db
            .insert(anthropicSyncStatus)
            .values({
              userId: u.userId,
              resolvedApiKeyId: apiKeyId,
              resolvedWorkspaceId: workspaceId,
            })
            .onConflictDoUpdate({
              target: [anthropicSyncStatus.userId],
              set: { resolvedApiKeyId: apiKeyId, resolvedWorkspaceId: workspaceId },
            });
        }
      } catch (err) {
        console.error(`Failed to resolve API key for user ${u.userId}:`, err);
      }
    }
  }

  return mapping;
}

// ---------------------------------------------------------------------------
// Helper: compute sync date window
// ---------------------------------------------------------------------------

function formatAnthropicTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, "Z");
}

export function computeSyncWindow(latestDateStr: string | null): { startingAt: string; endingAt: string } {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  let startDate: Date;
  if (latestDateStr) {
    startDate = new Date(latestDateStr);
    startDate.setUTCHours(0, 0, 0, 0);
    startDate.setUTCDate(startDate.getUTCDate() - 1);
  } else {
    startDate = new Date(now);
    startDate.setUTCDate(startDate.getUTCDate() - DEFAULT_BACKFILL_DAYS);
  }
  // End at start-of-today; today is covered separately with hourly buckets
  const endDate = new Date(now);

  // Guard against a zero-width or inverted range. With bucket_width=1d the
  // usage_report API rejects ending_at <= starting_at with a 400 ("ending date
  // must be after starting date"), the same failure that hit the cost path on
  // the 1st (#103). latestDateStr should always be < today, and even a same-day
  // row is safe because we subtract a day (latest == today still yields a valid
  // [yesterday, today) window). Only a future-dated row (bad backfill, clock
  // skew, timezone edge) could push startDate to/after endDate. Clamp so the
  // historical window always spans at least one complete day ending at
  // start-of-today.
  const maxStart = new Date(endDate);
  maxStart.setUTCDate(maxStart.getUTCDate() - 1);
  if (startDate.getTime() > maxStart.getTime()) {
    startDate = maxStart;
  }

  return {
    startingAt: formatAnthropicTimestamp(startDate),
    endingAt: formatAnthropicTimestamp(endDate),
  };
}

// ---------------------------------------------------------------------------
// Helper: today's sync window (start of today UTC → start of tomorrow UTC)
// ---------------------------------------------------------------------------

function todaySyncWindow(): { startingAt: string; endingAt: string } {
  const now = new Date();
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);
  return {
    startingAt: formatAnthropicTimestamp(todayStart),
    endingAt: formatAnthropicTimestamp(tomorrowStart),
  };
}

// ---------------------------------------------------------------------------
// Helper: aggregate hourly buckets into daily totals
// ---------------------------------------------------------------------------

function aggregateHourlyBuckets(
  buckets: z.infer<typeof usageBucketSchema>[]
): z.infer<typeof usageBucketSchema>[] {
  const dateMap = new Map<
    string,
    Map<
      string,
      {
        model: string | null;
        api_key_id: string | null;
        uncached_input_tokens: number;
        cache_read_input_tokens: number;
        cache_creation_5m: number;
        cache_creation_1h: number;
        output_tokens: number;
      }
    >
  >();

  for (const bucket of buckets) {
    const dateStr = bucket.starting_at.split("T")[0];
    if (!dateMap.has(dateStr)) dateMap.set(dateStr, new Map());
    const resultMap = dateMap.get(dateStr)!;

    for (const r of bucket.results) {
      const key = `${r.model ?? ""}|${r.api_key_id ?? ""}`;
      const cc5m = r.cache_creation?.ephemeral_5m_input_tokens ?? 0;
      const cc1h = r.cache_creation?.ephemeral_1h_input_tokens ?? 0;
      const existing = resultMap.get(key);

      if (existing) {
        existing.uncached_input_tokens += r.uncached_input_tokens;
        existing.cache_read_input_tokens += r.cache_read_input_tokens;
        existing.cache_creation_5m += cc5m;
        existing.cache_creation_1h += cc1h;
        existing.output_tokens += r.output_tokens;
      } else {
        resultMap.set(key, {
          model: r.model ?? null,
          api_key_id: r.api_key_id ?? null,
          uncached_input_tokens: r.uncached_input_tokens,
          cache_read_input_tokens: r.cache_read_input_tokens,
          cache_creation_5m: cc5m,
          cache_creation_1h: cc1h,
          output_tokens: r.output_tokens,
        });
      }
    }
  }

  return Array.from(dateMap.entries()).map(([dateStr, resultMap]) => {
    const nextDay = new Date(dateStr + "T00:00:00Z");
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    return {
      starting_at: `${dateStr}T00:00:00Z`,
      ending_at: formatAnthropicTimestamp(nextDay),
      results: Array.from(resultMap.values()).map((v) => ({
        model: v.model,
        api_key_id: v.api_key_id,
        uncached_input_tokens: v.uncached_input_tokens,
        cache_read_input_tokens: v.cache_read_input_tokens,
        cache_creation: {
          ephemeral_5m_input_tokens: v.cache_creation_5m,
          ephemeral_1h_input_tokens: v.cache_creation_1h,
        },
        output_tokens: v.output_tokens,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Helper: fetch today's usage with hourly granularity and aggregate to daily
// ---------------------------------------------------------------------------

async function fetchTodayAggregated(
  apiKeyIds?: string[]
): Promise<z.infer<typeof usageBucketSchema>[]> {
  const { startingAt, endingAt } = todaySyncWindow();
  const response = await fetchAnthropicUsage(startingAt, endingAt, apiKeyIds, "1h");
  return aggregateHourlyBuckets(response.data);
}

// ---------------------------------------------------------------------------
// Helper: prepare a usage row for batch upsert
// ---------------------------------------------------------------------------

export function prepareUsageRow(
  userId: number,
  bucketDate: string,
  result: z.infer<typeof usageBucketResultSchema>
) {
  const model = result.model;
  if (!model) return null;

  const cacheCreationTokens =
    (result.cache_creation?.ephemeral_5m_input_tokens ?? 0) +
    (result.cache_creation?.ephemeral_1h_input_tokens ?? 0);
  const { pricing, resolved } = resolveModelPricing(model);
  const costCents = computeCostCents(
    {
      uncachedInputTokens: result.uncached_input_tokens,
      cacheReadInputTokens: result.cache_read_input_tokens,
      cacheCreationInputTokens: cacheCreationTokens,
      outputTokens: result.output_tokens,
    },
    pricing
  );

  return {
    userId,
    date: bucketDate,
    model,
    uncachedInputTokens: result.uncached_input_tokens,
    cacheReadInputTokens: result.cache_read_input_tokens,
    cacheCreationInputTokens: cacheCreationTokens,
    outputTokens: result.output_tokens,
    computedCostCents: costCents,
    pricingResolved: resolved,
    updatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Helper: batch upsert usage rows
// ---------------------------------------------------------------------------

const BATCH_SIZE = 50;

export async function batchUpsertUsageRows(
  rows: NonNullable<ReturnType<typeof prepareUsageRow>>[]
) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await db
      .insert(anthropicUsageMetrics)
      .values(batch)
      .onConflictDoUpdate({
        target: [
          anthropicUsageMetrics.userId,
          anthropicUsageMetrics.date,
          anthropicUsageMetrics.model,
        ],
        set: {
          uncachedInputTokens: sql`excluded.uncached_input_tokens`,
          cacheReadInputTokens: sql`excluded.cache_read_input_tokens`,
          cacheCreationInputTokens: sql`excluded.cache_creation_input_tokens`,
          outputTokens: sql`excluded.output_tokens`,
          computedCostCents: sql`excluded.computed_cost_cents`,
          pricingResolved: sql`excluded.pricing_resolved`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
}

// ---------------------------------------------------------------------------
// Global sync core: fetch all org usage and distribute to users (no locking)
// ---------------------------------------------------------------------------

export async function runAnthropicSyncCore(): Promise<SyncSummary> {
  const summary: SyncSummary = { syncedUsers: 0, skippedUsers: 0, syncedDays: 0, errors: [] };

  // Ensure sentinel row exists (userId=0) for status tracking
  await db
    .insert(anthropicSyncStatus)
    .values({ userId: LOCK_USER_ID })
    .onConflictDoNothing({ target: [anthropicSyncStatus.userId] });

  // Mark sync start on sentinel row
  await db
    .update(anthropicSyncStatus)
    .set({ lastSyncStartedAt: new Date(), lastSyncError: null })
    .where(eq(anthropicSyncStatus.userId, LOCK_USER_ID));

  try {
    // Resolve all mappings
    const apiKeyToUser = await resolveAllMappings();
    if (apiKeyToUser.size === 0) {
      return { syncedUsers: 0, skippedUsers: 0, syncedDays: 0, errors: [{ userId: 0, error: "No users with resolved API keys" }] };
    }

    // Incremental sync: start from the latest stored date (or 31 days back)
    // This handles month boundaries correctly — if cron was down, it backfills
    const oldestLatest = await db
      .select({ maxDate: sql<string>`MAX(${anthropicUsageMetrics.date})` })
      .from(anthropicUsageMetrics);

    const { startingAt, endingAt } = computeSyncWindow(oldestLatest[0]?.maxDate ?? null);

    // Fetch historical (daily) and today (hourly, ~5 min freshness) in parallel
    const [response, todayBuckets] = await Promise.all([
      fetchAnthropicUsage(startingAt, endingAt),
      fetchTodayAggregated(),
    ]);

    // Track which users received data and unique synced days
    const usersWithData = new Set<number>();
    const syncedDates = new Set<string>();

    // Collect all rows for batch upsert
    const pendingRows: NonNullable<ReturnType<typeof prepareUsageRow>>[] = [];

    for (const bucket of [...response.data, ...todayBuckets]) {
      const bucketDate = bucket.starting_at.split("T")[0];

      for (const result of bucket.results) {
        const apiKeyId = result.api_key_id;
        const model = result.model;
        if (!apiKeyId || !model) continue;

        const userId = apiKeyToUser.get(apiKeyId);
        if (!userId) continue;

        usersWithData.add(userId);
        syncedDates.add(bucketDate);

        const row = prepareUsageRow(userId, bucketDate, result);
        if (row) pendingRows.push(row);
      }
    }

    // Batch upsert all collected rows
    await batchUpsertUsageRows(pendingRows);

    // Batch update sync status for all users that received data
    const userIds = Array.from(usersWithData);
    if (userIds.length > 0) {
      await db
        .update(anthropicSyncStatus)
        .set({ lastSyncCompletedAt: new Date(), lastSyncError: null })
        .where(inArray(anthropicSyncStatus.userId, userIds));
    }

    // Mark completion on sentinel row (including syncedDays)
    const totalSyncedDays = syncedDates.size;
    await db
      .update(anthropicSyncStatus)
      .set({ lastSyncCompletedAt: new Date(), lastSyncError: null, syncedDays: totalSyncedDays })
      .where(eq(anthropicSyncStatus.userId, LOCK_USER_ID));

    summary.syncedUsers = usersWithData.size;
    summary.syncedDays = totalSyncedDays;
    summary.skippedUsers = new Set(apiKeyToUser.values()).size - usersWithData.size;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Anthropic sync failed:", errorMsg);
    // Set error on sentinel row only
    await db
      .update(anthropicSyncStatus)
      .set({ lastSyncError: errorMsg.slice(0, 500) })
      .where(eq(anthropicSyncStatus.userId, LOCK_USER_ID));
    summary.errors.push({ userId: 0, error: errorMsg });
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Global sync with row-level lock (standalone entry point)
// ---------------------------------------------------------------------------

export async function runAnthropicSync(): Promise<SyncSummary> {
  // Ensure sentinel row exists
  await db
    .insert(anthropicSyncStatus)
    .values({ userId: LOCK_USER_ID })
    .onConflictDoNothing({ target: [anthropicSyncStatus.userId] });

  // Atomic lock acquisition: only proceed if the row is not locked or lock is stale
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - LOCK_TIMEOUT_MS);
  const cooldownThreshold = new Date(now.getTime() - LOCK_COOLDOWN_MS);

  const [lockAcquired] = await db
    .update(anthropicSyncStatus)
    .set({ lastSyncStartedAt: now, lastSyncError: null })
    .where(
      and(
        eq(anthropicSyncStatus.userId, LOCK_USER_ID),
        sql`(
          ${anthropicSyncStatus.lastSyncStartedAt} IS NULL
          OR (
            ${anthropicSyncStatus.lastSyncCompletedAt} IS NOT NULL
            AND ${anthropicSyncStatus.lastSyncCompletedAt} >= ${anthropicSyncStatus.lastSyncStartedAt}
            AND ${anthropicSyncStatus.lastSyncCompletedAt} < ${cooldownThreshold}
          )
          OR (
            ${anthropicSyncStatus.lastSyncCompletedAt} IS NOT NULL
            AND ${anthropicSyncStatus.lastSyncCompletedAt} >= ${anthropicSyncStatus.lastSyncStartedAt}
            AND ${anthropicSyncStatus.lastSyncStartedAt} < ${cooldownThreshold}
          )
          OR (
            (${anthropicSyncStatus.lastSyncCompletedAt} IS NULL
             OR ${anthropicSyncStatus.lastSyncCompletedAt} < ${anthropicSyncStatus.lastSyncStartedAt})
            AND ${anthropicSyncStatus.lastSyncStartedAt} < ${staleThreshold}
          )
        )`
      )
    )
    .returning();

  if (!lockAcquired) {
    return { syncedUsers: 0, skippedUsers: 0, syncedDays: 0, errors: [{ userId: 0, error: "Sync already in progress or completed recently" }] };
  }

  return runAnthropicSyncCore();
}

// ---------------------------------------------------------------------------
// Single-user sync (admin manual trigger)
// ---------------------------------------------------------------------------

export async function syncSingleUser(userId: number): Promise<{ syncedDays: number; latestDate: string | null }> {
  // Get or create sync status
  let syncStatus = await db.query.anthropicSyncStatus.findFirst({
    where: eq(anthropicSyncStatus.userId, userId),
  });

  if (!syncStatus) {
    const [created] = await db
      .insert(anthropicSyncStatus)
      .values({ userId })
      .returning();
    syncStatus = created;
  }

  // Mark sync start time
  await db
    .update(anthropicSyncStatus)
    .set({ lastSyncStartedAt: new Date(), lastSyncError: null })
    .where(eq(anthropicSyncStatus.userId, userId));

  try {
    // Resolve API key ID if not cached
    if (!syncStatus.resolvedApiKeyId) {
      const [assignment] = await db
        .select({
          apiKeyEncrypted: licenseAssignments.apiKeyEncrypted,
        })
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

      if (!assignment?.apiKeyEncrypted) {
        throw new Error("No API key configured for this user");
      }

      const decrypted = await decryptApiKey(assignment.apiKeyEncrypted);
      const orgKeys = await fetchOrgApiKeys();
      const apiKeyId = resolveApiKeyId(decrypted, orgKeys);
      if (!apiKeyId) {
        throw new Error("Could not resolve API key ID from org keys");
      }

      await db
        .update(anthropicSyncStatus)
        .set({ resolvedApiKeyId: apiKeyId })
        .where(eq(anthropicSyncStatus.userId, userId));

      syncStatus = { ...syncStatus, resolvedApiKeyId: apiKeyId };
    }

    // Determine start date
    const latestRow = await db.query.anthropicUsageMetrics.findFirst({
      where: eq(anthropicUsageMetrics.userId, userId),
      orderBy: desc(anthropicUsageMetrics.date),
    });

    const { startingAt, endingAt } = computeSyncWindow(latestRow?.date ?? null);

    // Fetch historical (daily) and today (hourly, ~5 min freshness) in parallel
    const apiKeyFilter = [syncStatus.resolvedApiKeyId!];
    const [response, todayBuckets] = await Promise.all([
      fetchAnthropicUsage(startingAt, endingAt, apiKeyFilter),
      fetchTodayAggregated(apiKeyFilter),
    ]);

    // Collect all rows for batch upsert
    const pendingRows: NonNullable<ReturnType<typeof prepareUsageRow>>[] = [];
    const syncedDates = new Set<string>();
    let latestDate: string | null = null;

    for (const bucket of [...response.data, ...todayBuckets]) {
      const bucketDate = bucket.starting_at.split("T")[0];

      for (const result of bucket.results) {
        const row = prepareUsageRow(userId, bucketDate, result);
        if (row) pendingRows.push(row);
      }

      syncedDates.add(bucketDate);
      if (!latestDate || bucketDate > latestDate) {
        latestDate = bucketDate;
      }
    }

    // Batch upsert all collected rows
    await batchUpsertUsageRows(pendingRows);

    const syncedDays = syncedDates.size;
    await db
      .update(anthropicSyncStatus)
      .set({
        lastSyncCompletedAt: new Date(),
        lastSyncError: null,
        syncedDays,
      })
      .where(eq(anthropicSyncStatus.userId, userId));

    return { syncedDays, latestDate };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await db
      .update(anthropicSyncStatus)
      .set({
        lastSyncError: errorMsg.slice(0, 500),
        lastSyncCompletedAt: new Date(),
      })
      .where(eq(anthropicSyncStatus.userId, userId));
    throw err;
  }
}
