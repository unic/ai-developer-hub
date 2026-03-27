import { db } from "@/lib/db";
import {
  anthropicUsageMetrics,
  anthropicSyncStatus,
  anthropicPlanConnections,
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCK_USER_ID = 0;
const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — stale lock threshold
const LOCK_COOLDOWN_MS = 60 * 1000; // 60 seconds — minimum between syncs
const DEFAULT_BACKFILL_DAYS = 31;

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
  adminApiKey: string,
  startingAt: string,
  endingAt: string,
  apiKeyIds?: string[]
): Promise<z.infer<typeof usageReportResponseSchema>> {

  // Build query string manually — URLSearchParams encodes [] as %5B%5D
  // which the Anthropic API does not recognise for array parameters.
  const parts = [
    `starting_at=${encodeURIComponent(startingAt)}`,
    `ending_at=${encodeURIComponent(endingAt)}`,
    "bucket_width=1d",
    "group_by[]=model",
    "group_by[]=api_key_id",
    `limit=${DEFAULT_BACKFILL_DAYS}`,
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
        "x-api-key": adminApiKey,
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

export async function resolveAllMappings(
  adminApiKey: string,
  planConnectionId: number
): Promise<Map<string, number>> {
  const mapping = new Map<string, number>();

  // Get existing cached mappings for this plan
  const existing = await db.query.anthropicSyncStatus.findMany({
    where: and(
      isNotNull(anthropicSyncStatus.resolvedApiKeyId),
      eq(anthropicSyncStatus.planConnectionId, planConnectionId)
    ),
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

  // Build a set of existing sync status rows for staleness check
  const existingSyncMap = new Map(
    existing.map((row) => [row.userId, row])
  );

  // Re-resolve if: no cached mapping, or the assignment was updated after the last resolve
  const needsResolve = usersWithKeys.filter((u) => {
    if (!Array.from(mapping.values()).includes(u.userId)) {
      return true;
    }
    const syncRow = existingSyncMap.get(u.userId);
    if (syncRow?.resolvedApiKeyId && u.keyUpdatedAt > (syncRow.lastSyncCompletedAt ?? new Date(0))) {
      return true;
    }
    return false;
  });

  if (needsResolve.length > 0) {
    const orgKeys = await fetchOrgApiKeys(adminApiKey);

    for (const u of needsResolve) {
      if (!u.apiKeyEncrypted) continue;
      try {
        const decrypted = await decryptApiKey(u.apiKeyEncrypted);
        const apiKeyId = resolveApiKeyId(decrypted, orgKeys);
        if (apiKeyId) {
          mapping.set(apiKeyId, u.userId);
          // Upsert sync status with resolved ID and plan
          await db.execute(sql`
            INSERT INTO anthropic_sync_status (user_id, resolved_api_key_id, plan_connection_id)
            VALUES (${u.userId}, ${apiKeyId}, ${planConnectionId})
            ON CONFLICT (user_id, plan_connection_id)
            DO UPDATE SET resolved_api_key_id = ${apiKeyId}
          `);
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
    startDate.setUTCDate(startDate.getUTCDate() - 1);
  } else {
    startDate = new Date(now);
    startDate.setUTCDate(startDate.getUTCDate() - DEFAULT_BACKFILL_DAYS);
  }
  const endDate = new Date(now);
  endDate.setUTCDate(endDate.getUTCDate() + 1);

  return {
    startingAt: startDate.toISOString().replace(/\.\d+Z$/, "Z"),
    endingAt: endDate.toISOString().replace(/\.\d+Z$/, "Z"),
  };
}

// ---------------------------------------------------------------------------
// Helper: prepare a usage row for batch upsert
// ---------------------------------------------------------------------------

export function prepareUsageRow(
  userId: number,
  bucketDate: string,
  result: z.infer<typeof usageBucketResultSchema>,
  planConnectionId?: number
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
    ...(planConnectionId != null ? { planConnectionId } : {}),
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
          anthropicUsageMetrics.planConnectionId,
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

  // Get all active plan connections
  const plans = await db
    .select()
    .from(anthropicPlanConnections)
    .where(eq(anthropicPlanConnections.status, "active"));

  if (plans.length === 0) {
    summary.errors.push({ userId: 0, error: "No active plan connections found" });
    return summary;
  }

  for (const plan of plans) {
    try {
      const adminApiKey = await decryptApiKey(plan.adminApiKeyEncrypted);

      // Resolve all mappings for this plan
      const apiKeyToUser = await resolveAllMappings(adminApiKey, plan.id);
      if (apiKeyToUser.size === 0) {
        summary.skippedUsers++;
        continue;
      }

      // Incremental sync: start from the latest stored date for this plan
      const oldestLatest = await db
        .select({ maxDate: sql<string>`MAX(${anthropicUsageMetrics.date})` })
        .from(anthropicUsageMetrics)
        .where(eq(anthropicUsageMetrics.planConnectionId, plan.id));

      const { startingAt, endingAt } = computeSyncWindow(oldestLatest[0]?.maxDate ?? null);

      // Fetch all org usage for this plan
      const response = await fetchAnthropicUsage(adminApiKey, startingAt, endingAt);

      const usersWithData = new Set<number>();
      const syncedDates = new Set<string>();
      const pendingRows: NonNullable<ReturnType<typeof prepareUsageRow>>[] = [];

      for (const bucket of response.data) {
        const bucketDate = bucket.starting_at.split("T")[0];

        for (const result of bucket.results) {
          const apiKeyId = result.api_key_id;
          const model = result.model;
          if (!apiKeyId || !model) continue;

          const userId = apiKeyToUser.get(apiKeyId);
          if (!userId) continue;

          usersWithData.add(userId);
          syncedDates.add(bucketDate);

          const row = prepareUsageRow(userId, bucketDate, result, plan.id);
          if (row) pendingRows.push(row);
        }
      }

      await batchUpsertUsageRows(pendingRows);

      summary.syncedUsers += usersWithData.size;
      summary.syncedDays += syncedDates.size;
      summary.skippedUsers += new Set(apiKeyToUser.values()).size - usersWithData.size;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`Anthropic sync failed for plan "${plan.label}":`, errorMsg);
      summary.errors.push({ userId: 0, error: `Plan "${plan.label}": ${errorMsg}` });
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Global sync with row-level lock (standalone entry point)
// ---------------------------------------------------------------------------

export async function runAnthropicSync(): Promise<SyncSummary> {
  // Locking is now handled by the sync framework (withSyncLock in anthropic-usage source)
  return runAnthropicSyncCore();
}

// ---------------------------------------------------------------------------
// Single-user sync (admin manual trigger)
// ---------------------------------------------------------------------------

export async function syncSingleUser(userId: number): Promise<{ syncedDays: number; latestDate: string | null }> {
  // Find the user's resolved plan by checking sync status
  const existingSyncStatus = await db.query.anthropicSyncStatus.findFirst({
    where: and(
      eq(anthropicSyncStatus.userId, userId),
      isNotNull(anthropicSyncStatus.planConnectionId)
    ),
  });

  // Get the user's API key assignment
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

  // If we have a cached plan, use it. Otherwise, resolve across all plans.
  let resolvedPlanId: number | null = existingSyncStatus?.planConnectionId ?? null;
  let resolvedApiKeyId = existingSyncStatus?.resolvedApiKeyId ?? null;
  let adminApiKey: string | null = null;

  if (resolvedPlanId && resolvedApiKeyId) {
    // Use cached plan
    const plan = await db.query.anthropicPlanConnections.findFirst({
      where: and(
        eq(anthropicPlanConnections.id, resolvedPlanId),
        eq(anthropicPlanConnections.status, "active")
      ),
    });
    if (plan) {
      adminApiKey = await decryptApiKey(plan.adminApiKeyEncrypted);
    }
  }

  // If no cached plan or plan was disconnected, resolve across all active plans
  if (!adminApiKey) {
    const plans = await db
      .select()
      .from(anthropicPlanConnections)
      .where(eq(anthropicPlanConnections.status, "active"));

    const decryptedUserKey = await decryptApiKey(assignment.apiKeyEncrypted);

    for (const plan of plans) {
      const planAdminKey = await decryptApiKey(plan.adminApiKeyEncrypted);
      const orgKeys = await fetchOrgApiKeys(planAdminKey);
      const keyId = resolveApiKeyId(decryptedUserKey, orgKeys);
      if (keyId) {
        resolvedPlanId = plan.id;
        resolvedApiKeyId = keyId;
        adminApiKey = planAdminKey;
        // Cache the resolution
        await db.execute(sql`
          INSERT INTO anthropic_sync_status (user_id, resolved_api_key_id, plan_connection_id)
          VALUES (${userId}, ${keyId}, ${plan.id})
          ON CONFLICT (user_id, plan_connection_id)
          DO UPDATE SET resolved_api_key_id = ${keyId}
        `);
        break;
      }
    }
  }

  if (!adminApiKey || !resolvedApiKeyId || !resolvedPlanId) {
    throw new Error("Could not resolve API key ID from any active plan");
  }

  try {
    const latestRow = await db.query.anthropicUsageMetrics.findFirst({
      where: eq(anthropicUsageMetrics.userId, userId),
      orderBy: desc(anthropicUsageMetrics.date),
    });

    const { startingAt, endingAt } = computeSyncWindow(latestRow?.date ?? null);

    const response = await fetchAnthropicUsage(adminApiKey, startingAt, endingAt, [resolvedApiKeyId]);

    const pendingRows: NonNullable<ReturnType<typeof prepareUsageRow>>[] = [];
    let syncedDays = 0;
    let latestDate: string | null = null;

    for (const bucket of response.data) {
      const bucketDate = bucket.starting_at.split("T")[0];
      for (const result of bucket.results) {
        const row = prepareUsageRow(userId, bucketDate, result, resolvedPlanId);
        if (row) pendingRows.push(row);
      }
      syncedDays++;
      if (!latestDate || bucketDate > latestDate) {
        latestDate = bucketDate;
      }
    }

    await batchUpsertUsageRows(pendingRows);

    return { syncedDays, latestDate };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`Single-user sync failed for user ${userId}:`, errorMsg);
    throw err;
  }
}
