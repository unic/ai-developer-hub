import { withSyncLock, retryWithBackoff, type SyncCounts } from "@/lib/sync/framework";
import { db } from "@/lib/db";
import { anthropicWorkspaceCosts } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { ANTHROPIC_API_VERSION } from "@/lib/anthropic-constants";
import { env } from "@/lib/env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RunOptions {
  force?: boolean;
  month?: string;
  backfillStartDate?: Date;
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

async function fetchWorkspaces(): Promise<z.infer<typeof workspacesResponseSchema>> {
  const adminKey = env.ANTHROPIC_ADMIN_API_KEY;
  if (!adminKey) throw new Error("ANTHROPIC_ADMIN_API_KEY is not set");

  const res = await fetch("https://api.anthropic.com/v1/organizations/workspaces", {
    headers: {
      "x-api-key": adminKey,
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
  startingAt: string,
  endingAt: string
): Promise<z.infer<typeof costReportBucketSchema>[]> {
  const adminKey = env.ANTHROPIC_ADMIN_API_KEY;
  if (!adminKey) throw new Error("ANTHROPIC_ADMIN_API_KEY is not set");

  const allBuckets: z.infer<typeof costReportBucketSchema>[] = [];
  let page: string | undefined;

  do {
    const query = [
      `starting_at=${encodeURIComponent(startingAt)}`,
      `ending_at=${encodeURIComponent(endingAt)}`,
      "bucket_width=1d",
      "group_by[]=workspace_id",
      ...(page ? [`page=${encodeURIComponent(page)}`] : []),
    ].join("&");

    const res = await fetch(
      `https://api.anthropic.com/v1/organizations/cost_report?${query}`,
      {
        headers: {
          "x-api-key": adminKey,
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

async function fetchAndUpsertWorkspaces(): Promise<number> {
  const response = await retryWithBackoff(() => fetchWorkspaces());

  // Use raw SQL to correctly target the partial unique index on workspace_id
  // (Drizzle generates incorrect WHERE clauses for partial-index ON CONFLICT).
  // Force is_default = FALSE for all named workspaces to avoid conflicting
  // with the Default Workspace row (workspace_id NULL, is_default = true).
  const now = new Date();
  if (response.data.length > 0) {
    const valuesSql = sql.join(
      response.data.map((ws) => sql`(${ws.id}, ${ws.name}, FALSE, ${ws.is_archived}, ${now}, ${now})`),
      sql`, `
    );
    await db.execute(sql`
      INSERT INTO anthropic_workspaces (workspace_id, name, is_default, is_archived, last_seen_at, updated_at)
      VALUES ${valuesSql}
      ON CONFLICT (workspace_id) WHERE workspace_id IS NOT NULL
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

/**
 * Aggregate a cost_report response into one entry per (workspace_id, day).
 *
 * Anthropic returns daily buckets (with `bucket_width=1d`) where each bucket's
 * `results[]` is grouped by `workspace_id`. A single workspace may appear in
 * multiple result rows of the same bucket (e.g., split by `cost_type`), which
 * must be summed into a single per-day cost.
 */
export function aggregateDailyCosts(
  buckets: z.infer<typeof costReportBucketSchema>[]
): { workspaceId: string | null; date: string; costCents: number }[] {
  // key: `${workspaceId ?? "__default__"}|${YYYY-MM-DD}`
  const byKey = new Map<
    string,
    { workspaceId: string | null; date: string; costCents: number }
  >();

  for (const bucket of buckets) {
    const date = bucket.starting_at.slice(0, 10); // "YYYY-MM-DDTHH:..." → "YYYY-MM-DD"
    for (const r of bucket.results) {
      const wsId = r.workspace_id ?? null;
      const key = `${wsId ?? "__default__"}|${date}`;
      const cents = Math.round(parseFloat(r.amount));
      const existing = byKey.get(key);
      if (existing) {
        existing.costCents += cents;
      } else {
        byKey.set(key, { workspaceId: wsId, date, costCents: cents });
      }
    }
  }

  return Array.from(byKey.values());
}

async function fetchAndUpsertWorkspaceCosts(month: string): Promise<number> {
  // month format: YYYY-MM
  const startDate = `${month}-01T00:00:00Z`;
  const endYear = parseInt(month.slice(0, 4));
  const endMonth = parseInt(month.slice(5, 7));
  const nextMonth = endMonth === 12 ? 1 : endMonth + 1;
  const nextYear = endMonth === 12 ? endYear + 1 : endYear;
  const monthEndDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00Z`;

  // Cap endDate to now — Anthropic rejects requests where ending_at is in the future.
  const now = new Date();
  const startDateObj = new Date(startDate);
  const monthEndDateObj = new Date(monthEndDate);
  const effectiveEnd = monthEndDateObj > now ? now : monthEndDateObj;
  if (effectiveEnd.getTime() <= startDateObj.getTime()) {
    // Month hasn't started yet or no time has elapsed — nothing to sync.
    return 0;
  }
  const endDate = effectiveEnd.toISOString();

  const buckets = await retryWithBackoff(() =>
    fetchCostReport(startDate, endDate)
  );

  const dailyRows = aggregateDailyCosts(buckets);

  let upserted = 0;
  for (const { workspaceId, date, costCents } of dailyRows) {
    if (workspaceId) {
      await db.execute(sql`
        INSERT INTO anthropic_workspace_costs (workspace_id, date, cost_cents)
        VALUES (${workspaceId}, ${date}, ${costCents})
        ON CONFLICT (workspace_id, date) WHERE workspace_id IS NOT NULL
        DO UPDATE SET cost_cents = ${costCents}, updated_at = now()
      `);
    } else {
      // Default workspace (null workspace_id)
      await db.execute(sql`
        INSERT INTO anthropic_workspace_costs (workspace_id, date, cost_cents)
        VALUES (NULL, ${date}, ${costCents})
        ON CONFLICT (date) WHERE workspace_id IS NULL
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
    },
    async (eventId) => {
      const counts: SyncCounts = {
        createdCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        errorCount: 0,
      };

      // Non-fatal — cost sync can proceed without workspace metadata
      try {
        counts.createdCount = await fetchAndUpsertWorkspaces();
      } catch (err) {
        const msg = `Workspace metadata sync failed: ${err instanceof Error ? err.message : String(err)}`;
        appendError(counts, msg);
        console.warn(`[anthropic-api-costs] ${msg} — continuing with cost sync`);
      }

      if (opts?.backfillStartDate) {
        const start = opts.backfillStartDate;
        const now = new Date();
        const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
        const failedMonths: string[] = [];

        while (current <= now) {
          const month = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}`;
          try {
            counts.updatedCount += await fetchAndUpsertWorkspaceCosts(month);
          } catch (err) {
            failedMonths.push(month);
            appendError(counts, `Backfill failed for ${month}: ${err instanceof Error ? err.message : String(err)}`);
          }
          current.setUTCMonth(current.getUTCMonth() + 1);
        }

        if (failedMonths.length > 0) {
          console.warn(`[anthropic-api-costs] Backfill failed for months: ${failedMonths.join(", ")}`);
        }
      } else {
        try {
          const now = new Date();
          const month = opts?.month ??
            `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
          counts.updatedCount = await fetchAndUpsertWorkspaceCosts(month);
        } catch (err) {
          appendError(counts, `Cost sync failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return counts;
    }
  );
}
