"use server";

import { db } from "@/lib/db";
import {
  anthropicUsageMetrics,
  anthropicSyncStatus,
  licenseAssignments,
  aiTools,
  users,
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
    .optional()
    .default({}),
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

  const params = new URLSearchParams();
  params.set("starting_at", startingAt);
  params.set("ending_at", endingAt);
  params.set("bucket_width", "1d");
  params.append("group_by[]", "model");
  params.append("group_by[]", "api_key_id");
  params.set("limit", "31");

  if (apiKeyIds) {
    for (const id of apiKeyIds) {
      params.append("api_key_ids[]", id);
    }
  }

  const res = await fetch(
    `https://api.anthropic.com/v1/organizations/usage_report/messages?${params.toString()}`,
    {
      headers: {
        "x-api-key": adminKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }

  return usageReportResponseSchema.parse(await res.json());
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
        sql`LOWER(${aiTools.vendor}) LIKE '%anthropic%' OR LOWER(${aiTools.name}) LIKE '%claude%'`
      )
    );

  // Filter to users without cached mapping
  const unmapped = usersWithKeys.filter(
    (u) => !Array.from(mapping.values()).includes(u.userId)
  );

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
// Global sync: fetch all org usage and distribute to users
// ---------------------------------------------------------------------------

export async function runAnthropicSync(): Promise<SyncSummary> {
  const summary: SyncSummary = { syncedUsers: 0, skippedUsers: 0, errors: [] };

  // Global concurrency guard: check if any sync is in progress
  const inProgress = await db.query.anthropicSyncStatus.findFirst({
    where: and(
      isNotNull(anthropicSyncStatus.lastSyncStartedAt),
      sql`${anthropicSyncStatus.lastSyncStartedAt} > NOW() - INTERVAL '60 seconds'`,
      sql`(${anthropicSyncStatus.lastSyncCompletedAt} IS NULL OR ${anthropicSyncStatus.lastSyncCompletedAt} < ${anthropicSyncStatus.lastSyncStartedAt})`
    ),
  });

  if (inProgress) {
    // Check for stale lock (> 5 min)
    const staleCheck = await db.query.anthropicSyncStatus.findFirst({
      where: and(
        isNotNull(anthropicSyncStatus.lastSyncStartedAt),
        sql`${anthropicSyncStatus.lastSyncStartedAt} > NOW() - INTERVAL '5 minutes'`,
        sql`(${anthropicSyncStatus.lastSyncCompletedAt} IS NULL OR ${anthropicSyncStatus.lastSyncCompletedAt} < ${anthropicSyncStatus.lastSyncStartedAt})`
      ),
    });
    if (staleCheck) {
      return { syncedUsers: 0, skippedUsers: 0, errors: [{ userId: 0, error: "Sync already in progress" }] };
    }
  }

  // Set global lock
  await db
    .update(anthropicSyncStatus)
    .set({ lastSyncStartedAt: new Date(), lastSyncError: null });

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

    const now = new Date();
    let startDate: Date;
    if (oldestLatest[0]?.maxDate) {
      startDate = new Date(oldestLatest[0].maxDate);
      // Start from the day after the latest stored date
      startDate.setUTCDate(startDate.getUTCDate() + 1);
    } else {
      // No data: backfill 31 days
      startDate = new Date(now);
      startDate.setUTCDate(startDate.getUTCDate() - 31);
    }

    // End date is tomorrow (to include today)
    const endDate = new Date(now);
    endDate.setUTCDate(endDate.getUTCDate() + 1);

    const startingAt = startDate.toISOString().replace(/\.\d+Z$/, "Z");
    const endingAt = endDate.toISOString().replace(/\.\d+Z$/, "Z");

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

        // Compute cost
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

        // Upsert
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
    }

    // Update sync status per user
    for (const userId of usersWithData) {
      await db
        .update(anthropicSyncStatus)
        .set({ lastSyncCompletedAt: new Date(), lastSyncError: null })
        .where(eq(anthropicSyncStatus.userId, userId));
    }

    summary.syncedUsers = usersWithData.size;
    summary.skippedUsers = apiKeyToUser.size - usersWithData.size;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Anthropic sync failed:", errorMsg);
    // Set error on all sync status rows
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

  // Resolve API key ID if not cached
  if (!syncStatus.resolvedApiKeyId) {
    const assignment = await db.query.licenseAssignments.findFirst({
      where: and(
        eq(licenseAssignments.userId, userId),
        eq(licenseAssignments.status, "active"),
        isNotNull(licenseAssignments.apiKeyEncrypted)
      ),
      with: { tool: true },
    });

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

  const now = new Date();
  let startDate: Date;
  if (latestRow) {
    startDate = new Date(latestRow.date);
    startDate.setUTCDate(startDate.getUTCDate() + 1);
  } else {
    startDate = new Date(now);
    startDate.setUTCDate(startDate.getUTCDate() - 31);
  }

  const endDate = new Date(now);
  endDate.setUTCDate(endDate.getUTCDate() + 1);

  const startingAt = startDate.toISOString().replace(/\.\d+Z$/, "Z");
  const endingAt = endDate.toISOString().replace(/\.\d+Z$/, "Z");

  // Fetch filtered by this user's API key
  const response = await fetchAnthropicUsage(startingAt, endingAt, [syncStatus.resolvedApiKeyId]);

  let syncedDays = 0;
  let latestDate: string | null = null;

  for (const bucket of response.data) {
    const bucketDate = bucket.starting_at.split("T")[0];

    for (const result of bucket.results) {
      if (!result.model) continue;

      const cacheCreationTokens =
        (result.cache_creation?.ephemeral_5m_input_tokens ?? 0) +
        (result.cache_creation?.ephemeral_1h_input_tokens ?? 0);
      const tokens = {
        uncachedInputTokens: result.uncached_input_tokens,
        cacheReadInputTokens: result.cache_read_input_tokens,
        cacheCreationInputTokens: cacheCreationTokens,
        outputTokens: result.output_tokens,
      };
      const { pricing, resolved } = resolveModelPricing(result.model);
      const costCents = computeCostCents(tokens, pricing);

      await db
        .insert(anthropicUsageMetrics)
        .values({
          userId,
          date: bucketDate,
          model: result.model,
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
