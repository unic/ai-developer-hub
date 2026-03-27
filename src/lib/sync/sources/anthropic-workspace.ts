import { withSyncLock, retryWithBackoff, type SyncCounts } from "@/lib/sync/framework";
import { db } from "@/lib/db";
import { anthropicWorkspaceCosts, anthropicPlanConnections } from "@/lib/db/schema";
import { sql, eq } from "drizzle-orm";
import { z } from "zod";
import { ANTHROPIC_API_VERSION } from "@/lib/anthropic-constants";
import { decryptApiKey } from "@/lib/crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RunOptions {
  force?: boolean;
  month?: string;
  backfillStartDate?: Date;
  planConnectionId?: number;
}

// Zod schemas for Anthropic API responses
const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  is_default: z.boolean().optional().default(false),
  is_archived: z.boolean().optional().default(false),
});

const workspacesResponseSchema = z.object({
  data: z.array(workspaceSchema),
  has_more: z.boolean(),
});

const costReportResultSchema = z.object({
  workspace_id: z.string().nullable().optional(),
  amount: z.string(), // decimal string in cents, e.g. "123.45"
  currency: z.string().optional(),
  cost_type: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  token_type: z.string().nullable().optional(),
  context_window: z.string().nullable().optional(),
  inference_geo: z.string().nullable().optional(),
  service_tier: z.string().nullable().optional(),
});

const costReportBucketSchema = z.object({
  starting_at: z.string(),
  ending_at: z.string(),
  results: z.array(costReportResultSchema),
});

const costReportResponseSchema = z.object({
  data: z.array(costReportBucketSchema),
  has_more: z.boolean(),
  next_page: z.string().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchWorkspaces(adminApiKey: string): Promise<z.infer<typeof workspacesResponseSchema>> {
  const res = await fetch("https://api.anthropic.com/v1/organizations/workspaces", {
    headers: {
      "x-api-key": adminApiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic workspaces API error ${res.status}: ${body}`);
  }

  return workspacesResponseSchema.parse(await res.json());
}

async function fetchCostReport(
  adminApiKey: string,
  startingAt: string,
  endingAt: string
): Promise<z.infer<typeof costReportBucketSchema>[]> {

  const allBuckets: z.infer<typeof costReportBucketSchema>[] = [];
  let page: string | undefined;

  do {
    const query = [
      `starting_at=${encodeURIComponent(startingAt)}`,
      `ending_at=${encodeURIComponent(endingAt)}`,
      "group_by[]=workspace_id",
      ...(page ? [`page=${encodeURIComponent(page)}`] : []),
    ].join("&");

    const res = await fetch(
      `https://api.anthropic.com/v1/organizations/cost_report?${query}`,
      {
        headers: {
          "x-api-key": adminApiKey,
          "anthropic-version": ANTHROPIC_API_VERSION,
        },
      }
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic cost_report API error ${res.status}: ${body}`);
    }

    const parsed = costReportResponseSchema.parse(await res.json());
    allBuckets.push(...parsed.data);
    page = parsed.has_more ? (parsed.next_page ?? undefined) : undefined;
  } while (page);

  return allBuckets;
}

async function fetchAndUpsertWorkspaces(adminApiKey: string, planConnectionId: number): Promise<number> {
  const response = await retryWithBackoff(() => fetchWorkspaces(adminApiKey));

  // Use raw SQL to correctly target the partial unique index on workspace_id
  // (Drizzle generates incorrect WHERE clauses for partial-index ON CONFLICT).
  // Force is_default = FALSE for all named workspaces to avoid conflicting
  // with the Default Workspace row (workspace_id NULL, is_default = true).
  const now = new Date();
  if (response.data.length > 0) {
    const valuesSql = sql.join(
      response.data.map((ws) => sql`(${ws.id}, ${ws.name}, FALSE, ${ws.is_archived}, ${now}, ${planConnectionId}, ${now})`),
      sql`, `
    );
    await db.execute(sql`
      INSERT INTO anthropic_workspaces (workspace_id, name, is_default, is_archived, last_seen_at, plan_connection_id, updated_at)
      VALUES ${valuesSql}
      ON CONFLICT (workspace_id, plan_connection_id) WHERE workspace_id IS NOT NULL
      DO UPDATE SET
        name = EXCLUDED.name,
        is_default = FALSE,
        is_archived = EXCLUDED.is_archived,
        last_seen_at = EXCLUDED.last_seen_at,
        updated_at = EXCLUDED.updated_at
    `);
  }

  return response.data.length;
}

async function fetchAndUpsertWorkspaceCosts(adminApiKey: string, planConnectionId: number, month: string): Promise<number> {
  // month format: YYYY-MM
  const startDate = `${month}-01T00:00:00Z`;
  const endYear = parseInt(month.slice(0, 4));
  const endMonth = parseInt(month.slice(5, 7));
  const nextMonth = endMonth === 12 ? 1 : endMonth + 1;
  const nextYear = endMonth === 12 ? endYear + 1 : endYear;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00Z`;

  const buckets = await retryWithBackoff(() =>
    fetchCostReport(adminApiKey, startDate, endDate)
  );

  // Flatten all results across time buckets and aggregate per workspace
  const allResults = buckets.flatMap(bucket => bucket.results);
  const costByWorkspace = new Map<string | null, number>();
  for (const r of allResults) {
    const wsId = r.workspace_id ?? null;
    const amountCents = Math.round(parseFloat(r.amount));
    costByWorkspace.set(wsId, (costByWorkspace.get(wsId) ?? 0) + amountCents);
  }

  let upserted = 0;
  const dateStr = `${month}-01`;

  for (const [wsId, costCents] of costByWorkspace) {
    if (wsId) {
      await db.execute(sql`
        INSERT INTO anthropic_workspace_costs (workspace_id, date, cost_cents, plan_connection_id)
        VALUES (${wsId}, ${dateStr}, ${costCents}, ${planConnectionId})
        ON CONFLICT (workspace_id, date, plan_connection_id) WHERE workspace_id IS NOT NULL
        DO UPDATE SET cost_cents = ${costCents}, updated_at = now()
      `);
    } else {
      await db.execute(sql`
        INSERT INTO anthropic_workspace_costs (workspace_id, date, cost_cents, plan_connection_id)
        VALUES (NULL, ${dateStr}, ${costCents}, ${planConnectionId})
        ON CONFLICT (date, plan_connection_id) WHERE workspace_id IS NULL
        DO UPDATE SET cost_cents = ${costCents}, updated_at = now()
      `);
    }
    upserted++;
  }

  return upserted;
}

// ---------------------------------------------------------------------------
// Helpers — error tracking
// ---------------------------------------------------------------------------

function appendError(counts: SyncCounts, msg: string): void {
  counts.errorCount++;
  counts.errorMessage = counts.errorMessage
    ? `${counts.errorMessage}; ${msg}`
    : msg;
}

// ---------------------------------------------------------------------------
// Main run function
// ---------------------------------------------------------------------------

async function syncSinglePlan(
  adminApiKey: string,
  planConnectionId: number,
  counts: SyncCounts,
  opts?: RunOptions
): Promise<void> {
  // Non-fatal — cost sync can proceed without workspace metadata
  try {
    counts.createdCount += await fetchAndUpsertWorkspaces(adminApiKey, planConnectionId);
  } catch (err) {
    const msg = `Workspace metadata sync failed: ${err instanceof Error ? err.message : String(err)}`;
    appendError(counts, msg);
    console.warn(`[anthropic-api-costs] ${msg} — continuing with cost sync`);
  }

  if (opts?.backfillStartDate) {
    const start = opts.backfillStartDate;
    const now = new Date();
    const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));

    while (current <= now) {
      const month = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}`;
      try {
        counts.updatedCount += await fetchAndUpsertWorkspaceCosts(adminApiKey, planConnectionId, month);
      } catch (err) {
        appendError(counts, `Backfill failed for ${month}: ${err instanceof Error ? err.message : String(err)}`);
      }
      current.setUTCMonth(current.getUTCMonth() + 1);
    }
  } else {
    const now = new Date();
    const month = opts?.month ??
      `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    counts.updatedCount += await fetchAndUpsertWorkspaceCosts(adminApiKey, planConnectionId, month);
  }
}

export async function run(
  triggeredBy?: number,
  opts?: RunOptions
): Promise<{ eventId: number }> {
  return withSyncLock(
    {
      sourceType: "anthropic_api_costs",
      triggeredBy,
      operationType: opts?.backfillStartDate ? "backfill" : "regular",
      backfillStartDate: opts?.backfillStartDate,
      planConnectionId: opts?.planConnectionId,
    },
    async () => {
      const counts: SyncCounts = {
        createdCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        errorCount: 0,
      };

      // Determine which plans to sync
      let plans: { id: number; adminApiKeyEncrypted: string; label: string }[];
      if (opts?.planConnectionId) {
        const plan = await db.query.anthropicPlanConnections.findFirst({
          where: eq(anthropicPlanConnections.id, opts.planConnectionId),
        });
        if (!plan || plan.status !== "active") {
          appendError(counts, `Plan connection ${opts.planConnectionId} not found or not active`);
          return counts;
        }
        plans = [plan];
      } else {
        plans = await db
          .select()
          .from(anthropicPlanConnections)
          .where(eq(anthropicPlanConnections.status, "active"));
      }

      if (plans.length === 0) {
        counts.skippedCount = 1;
        appendError(counts, "No active plan connections found");
        return counts;
      }

      for (const plan of plans) {
        try {
          const adminApiKey = await decryptApiKey(plan.adminApiKeyEncrypted);
          await syncSinglePlan(adminApiKey, plan.id, counts, opts);
        } catch (err) {
          appendError(counts, `Plan "${plan.label}" failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return counts;
    }
  );
}
