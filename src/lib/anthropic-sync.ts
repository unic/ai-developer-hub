import { db } from "@/lib/db";
import {
  anthropicUsageMetrics,
  anthropicSyncStatus,
  licenseAssignments,
  aiTools,
} from "@/lib/db/schema";
import { eq, and, sql, desc, isNotNull } from "drizzle-orm";
import { decryptApiKey } from "@/lib/crypto";
import { fetchOrgApiKeys, resolveApiKeyId } from "@/lib/anthropic-keys";
import {
  resolveModelPricing,
  computeCostCents,
} from "@/lib/anthropic-pricing";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SyncSummary {
  syncedUsers: number;
  skippedUsers: number;
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
// Helper: fetch usage from Anthropic Admin API
// ---------------------------------------------------------------------------

async function fetchAnthropicUsage(
  startingAt: string,
  endingAt: string,
  apiKeyIds?: string[]
): Promise<z.infer<typeof usageReportResponseSchema>> {
  const adminKey = process.env.ANTHROPIC_ADMIN_API_KEY;
  if (!adminKey) throw new Error("ANTHROPIC_ADMIN_API_KEY is not set");

  // Build query string manually — URLSearchParams encodes [] as %5B%5D
  // which the Anthropic API does not recognise for array parameters.
  const parts = [
    `starting_at=${encodeURIComponent(startingAt)}`,
    `ending_at=${encodeURIComponent(endingAt)}`,
    "bucket_width=1d",
    "group_by[]=model",
    "group_by[]=api_key_id",
    "limit=31",
  ];

  if (apiKeyIds) {
    for (const id of apiKeyIds) {
      parts.push(`api_key_ids[]=${encodeURIComponent(id)}`);
    }
  }

  let url: string | null =
    `https://api.anthropic.com/v1/organizations/usage_report/messages?${parts.join("&")}`;
  const allData: z.infer<typeof usageBucketSchema>[] = [];

  while (url) {
    const res = await fetch(url, {
      headers: {
        "x-api-key": adminKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${body}`);
    }

    const page = usageReportResponseSchema.parse(await res.json());
    allData.push(...page.data);

    if (page.has_more && page.next_page) {
      url = page.next_page;
    } else {
      url = null;
    }
  }

  return { data: allData, has_more: false, next_page: null };
}

// ---------------------------------------------------------------------------
// Helper: resolve all api_key_id → userId mappings
// ---------------------------------------------------------------------------

async function resolveAllMappings(): Promise<Map<string, number>> {
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

  // Find users with Anthropic API keys but no cached mapping
  const usersWithKeys = await db
    .select({
      userId: licenseAssignments.userId,
      apiKeyEncrypted: licenseAssignments.apiKeyEncrypted,
    })
    .from(licenseAssignments)
    .innerJoin(aiTools, eq(licenseAssignments.toolId, aiTools.id))
    .where(
      and(
        eq(licenseAssignments.status, "active"),
        isNotNull(licenseAssignments.apiKeyEncrypted),
        sql`(LOWER(${aiTools.vendor}) LIKE '%anthropic%' OR LOWER(${aiTools.name}) LIKE '%claude%')`
      )
    );

  // Filter to users without cached mapping
  const mappedUserIds = new Set(mapping.values());
  const unmapped = usersWithKeys.filter((u) => !mappedUserIds.has(u.userId));

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
          // Upsert sync status with resolved ID
          await db
            .insert(anthropicSyncStatus)
            .values({ userId: u.userId, resolvedApiKeyId: apiKeyId })
            .onConflictDoUpdate({
              target: [anthropicSyncStatus.userId],
              set: { resolvedApiKeyId: apiKeyId },
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

function computeSyncWindow(latestDateStr: string | null): { startingAt: string; endingAt: string } {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  let startDate: Date;
  if (latestDateStr) {
    startDate = new Date(latestDateStr);
    startDate.setUTCHours(0, 0, 0, 0);
    startDate.setUTCDate(startDate.getUTCDate() + 1);
  } else {
    startDate = new Date(now);
    startDate.setUTCDate(startDate.getUTCDate() - 31);
  }
  const endDate = new Date(now);
  endDate.setUTCDate(endDate.getUTCDate() + 1);

  return {
    startingAt: startDate.toISOString().replace(/\.\d+Z$/, "Z"),
    endingAt: endDate.toISOString().replace(/\.\d+Z$/, "Z"),
  };
}

// ---------------------------------------------------------------------------
// Helper: upsert a single usage row
// ---------------------------------------------------------------------------

async function upsertUsageRow(
  userId: number,
  bucketDate: string,
  result: z.infer<typeof usageBucketResultSchema>
) {
  const model = result.model;
  if (!model) return;

  const cacheCreationTokens =
    (result.cache_creation?.ephemeral_5m_input_tokens ?? 0) +
    (result.cache_creation?.ephemeral_1h_input_tokens ?? 0);
  const tokens = {
    uncachedInputTokens: result.uncached_input_tokens,
    cacheReadInputTokens: result.cache_read_input_tokens,
    cacheCreationInputTokens: cacheCreationTokens,
    outputTokens: result.output_tokens,
  };
  const { pricing, resolved } = resolveModelPricing(model);
  const costCents = computeCostCents(tokens, pricing);

  await db
    .insert(anthropicUsageMetrics)
    .values({
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
    })
    .onConflictDoUpdate({
      target: [
        anthropicUsageMetrics.userId,
        anthropicUsageMetrics.date,
        anthropicUsageMetrics.model,
      ],
      set: {
        uncachedInputTokens: result.uncached_input_tokens,
        cacheReadInputTokens: result.cache_read_input_tokens,
        cacheCreationInputTokens: cacheCreationTokens,
        outputTokens: result.output_tokens,
        computedCostCents: costCents,
        pricingResolved: resolved,
        updatedAt: new Date(),
      },
    });
}

// ---------------------------------------------------------------------------
// Global sync: fetch all org usage and distribute to users
// ---------------------------------------------------------------------------

export async function runAnthropicSync(): Promise<SyncSummary> {
  const summary: SyncSummary = { syncedUsers: 0, skippedUsers: 0, errors: [] };

  // Ensure a dedicated global lock row exists (userId=0 sentinel)
  const LOCK_USER_ID = 0;
  await db
    .insert(anthropicSyncStatus)
    .values({ userId: LOCK_USER_ID })
    .onConflictDoNothing({ target: [anthropicSyncStatus.userId] });

  // Global concurrency guard: check the lock row
  const recentSync = await db.query.anthropicSyncStatus.findFirst({
    where: eq(anthropicSyncStatus.userId, LOCK_USER_ID),
  });

  if (recentSync?.lastSyncStartedAt) {
    const startedMs = recentSync.lastSyncStartedAt.getTime();
    const nowMs = Date.now();
    const isInProgress =
      (!recentSync.lastSyncCompletedAt ||
        recentSync.lastSyncCompletedAt < recentSync.lastSyncStartedAt);

    if (isInProgress) {
      // If started < 5 minutes ago, it's still running — skip
      if (nowMs - startedMs < 5 * 60 * 1000) {
        return { syncedUsers: 0, skippedUsers: 0, errors: [{ userId: 0, error: "Sync already in progress" }] };
      }
      // Stale lock (> 5 min) — allow new sync
    } else if (nowMs - startedMs < 60 * 1000) {
      // Completed less than 60 seconds ago — skip
      return { syncedUsers: 0, skippedUsers: 0, errors: [{ userId: 0, error: "Sync completed recently" }] };
    }
  }

  // Set global lock on the lock row
  await db
    .update(anthropicSyncStatus)
    .set({ lastSyncStartedAt: new Date(), lastSyncError: null })
    .where(eq(anthropicSyncStatus.userId, LOCK_USER_ID));

  try {
    // Resolve all mappings
    const apiKeyToUser = await resolveAllMappings();
    if (apiKeyToUser.size === 0) {
      return { syncedUsers: 0, skippedUsers: 0, errors: [{ userId: 0, error: "No users with resolved API keys" }] };
    }

    // Determine sync window: oldest MAX(date) across all users, or 31 days back
    const oldestLatest = await db
      .select({ maxDate: sql<string>`MAX(${anthropicUsageMetrics.date})` })
      .from(anthropicUsageMetrics);

    const { startingAt, endingAt } = computeSyncWindow(oldestLatest[0]?.maxDate ?? null);

    // Fetch all org usage in one call
    const response = await fetchAnthropicUsage(startingAt, endingAt);

    // Track which users received data
    const usersWithData = new Set<number>();

    // Process each bucket (day)
    for (const bucket of response.data) {
      const bucketDate = bucket.starting_at.split("T")[0];

      for (const result of bucket.results) {
        const apiKeyId = result.api_key_id;
        const model = result.model;
        if (!apiKeyId || !model) continue;

        const userId = apiKeyToUser.get(apiKeyId);
        if (!userId) {
          // Unknown key — skip silently
          continue;
        }

        usersWithData.add(userId);

        await upsertUsageRow(userId, bucketDate, result);
      }
    }

    // Update sync status per user
    for (const userId of usersWithData) {
      await db
        .update(anthropicSyncStatus)
        .set({ lastSyncCompletedAt: new Date(), lastSyncError: null })
        .where(eq(anthropicSyncStatus.userId, userId));
    }

    // Mark completion on ALL sync status rows (including lock row and users without data)
    await db
      .update(anthropicSyncStatus)
      .set({ lastSyncCompletedAt: new Date(), lastSyncError: null });

    summary.syncedUsers = usersWithData.size;
    summary.skippedUsers = new Set(apiKeyToUser.values()).size - usersWithData.size;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Anthropic sync failed:", errorMsg);
    // Set error on all sync status rows (including lock row userId=0)
    await db
      .update(anthropicSyncStatus)
      .set({ lastSyncError: errorMsg.slice(0, 500) });
    summary.errors.push({ userId: 0, error: errorMsg });
  }

  return summary;
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
          sql`(LOWER(${aiTools.vendor}) LIKE '%anthropic%' OR LOWER(${aiTools.name}) LIKE '%claude%')`
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

  // Fetch filtered by this user's API key
  const response = await fetchAnthropicUsage(startingAt, endingAt, [syncStatus.resolvedApiKeyId!]);

  let syncedDays = 0;
  let latestDate: string | null = null;

  for (const bucket of response.data) {
    const bucketDate = bucket.starting_at.split("T")[0];

    for (const result of bucket.results) {
      await upsertUsageRow(userId, bucketDate, result);
    }

    syncedDays++;
    if (!latestDate || bucketDate > latestDate) {
      latestDate = bucketDate;
    }
  }

  await db
    .update(anthropicSyncStatus)
    .set({
      lastSyncCompletedAt: new Date(),
      lastSyncError: null,
      syncedDays,
    })
    .where(eq(anthropicSyncStatus.userId, userId));

  return { syncedDays, latestDate };
}
