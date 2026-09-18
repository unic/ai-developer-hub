import { withSyncLock, retryWithBackoff, type SyncCounts } from "@/lib/sync/framework";
import { db } from "@/lib/db";
import { anthropicWorkspaceCosts, anthropicSyncStatus } from "@/lib/db/schema";
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
      // Splits each workspace-day into line items carrying model, cost_type,
      // token_type, context_window, service_tier and inference_geo. The
      // response schema already declared those fields — they were parsed and
      // discarded. This stops the discard; it costs no extra request.
      "group_by[]=description",
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

/** One billed line item: a workspace-day at full cost_report grain. */
export interface CostLineItem {
  workspaceId: string | null;
  date: string;
  model: string | null;
  costType: string | null;
  tokenType: string | null;
  contextWindow: string | null;
  serviceTier: string | null;
  inferenceGeo: string | null;
  /** Cents x 10^6 — see aggregateCostLineItems for why. */
  costMicrocents: number;
}

/** The unique index coalesces nullable grain columns to '', so an empty
 *  string from the API and a missing value would collide there. Normalise on
 *  the way in, where the collision is still visible. */
function blankToNull(v: string | null | undefined): string | null {
  return v == null || v === "" ? null : v;
}

/** The grain key. `inference_geo` is part of it: a live sample has Haiku 4.5
 *  reporting `not_available` beside `global` rows for the same workspace-day,
 *  and collapsing them would silently overwrite one with the other. */
function lineItemKey(r: {
  workspaceId: string | null;
  date: string;
  model: string | null;
  costType: string | null;
  tokenType: string | null;
  contextWindow: string | null;
  serviceTier: string | null;
  inferenceGeo: string | null;
}): string {
  return [
    r.workspaceId ?? "__default__",
    r.date,
    r.model ?? "",
    r.costType ?? "",
    r.tokenType ?? "",
    r.contextWindow ?? "",
    r.serviceTier ?? "",
    r.inferenceGeo ?? "",
  ].join("|");
}

/**
 * Aggregate a cost_report response into billed line items.
 *
 * `amount` is a decimal string OF CENTS with up to six decimal places
 * ("143.569125" = $1.4357). With `group_by[]=description` a workspace-day
 * arrives as 12-14 rows instead of one, so rounding each row to whole cents
 * before summing drifts by ~1 cent per workspace-day — enough to break the
 * "equals the Console to the cent" requirement. Store micro-cents and round
 * once, at the aggregate (contracts/cost-attribution.md R6).
 */
export function aggregateCostLineItems(
  buckets: z.infer<typeof costReportBucketSchema>[]
): CostLineItem[] {
  const byKey = new Map<string, CostLineItem>();

  for (const bucket of buckets) {
    const date = bucket.starting_at.slice(0, 10); // "YYYY-MM-DDTHH:..." → "YYYY-MM-DD"
    for (const r of bucket.results) {
      const item: CostLineItem = {
        workspaceId: r.workspace_id ?? null,
        date,
        model: blankToNull(r.model),
        costType: blankToNull(r.cost_type),
        tokenType: blankToNull(r.token_type),
        contextWindow: blankToNull(r.context_window),
        serviceTier: blankToNull(r.service_tier),
        inferenceGeo: blankToNull(r.inference_geo),
        costMicrocents: Math.round(parseFloat(r.amount) * 1_000_000),
      };
      const key = lineItemKey(item);
      const existing = byKey.get(key);
      if (existing) {
        existing.costMicrocents += item.costMicrocents;
      } else {
        byKey.set(key, item);
      }
    }
  }

  return Array.from(byKey.values());
}

/**
 * Aggregate a cost_report response into one entry per (workspace_id, day).
 *
 * DERIVED from the line items rather than computed independently, so the daily
 * rollup can never drift from its source (plan risk 8). The single rounding
 * happens here, on the summed micro-cents (R7).
 */
export function aggregateDailyCosts(
  buckets: z.infer<typeof costReportBucketSchema>[]
): { workspaceId: string | null; date: string; costCents: number }[] {
  return rollUpLineItems(aggregateCostLineItems(buckets));
}

/** Sum line items to whole cents per workspace-day. Rounds once, at the end. */
export function rollUpLineItems(
  items: CostLineItem[]
): { workspaceId: string | null; date: string; costCents: number }[] {
  const byKey = new Map<
    string,
    { workspaceId: string | null; date: string; microcents: number }
  >();

  for (const item of items) {
    const key = `${item.workspaceId ?? "__default__"}|${item.date}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.microcents += item.costMicrocents;
    } else {
      byKey.set(key, {
        workspaceId: item.workspaceId,
        date: item.date,
        microcents: item.costMicrocents,
      });
    }
  }

  return Array.from(byKey.values()).map((r) => ({
    workspaceId: r.workspaceId,
    date: r.date,
    costCents: Math.round(r.microcents / 1_000_000),
  }));
}

/**
 * Batch-upsert billed line items, one statement per partial-index bucket.
 *
 * Drizzle generates the wrong WHERE clause for a partial-index ON CONFLICT, so
 * this uses raw SQL with the index's own predicate — the same pattern the
 * daily rollup above already uses. The conflict target must repeat the
 * coalesce() expressions exactly as the index declares them.
 */
const LINE_ITEM_CHUNK = 500;

async function upsertCostLineItems(items: CostLineItem[]): Promise<void> {
  const named = items.filter((i) => i.workspaceId !== null);
  const fallback = items.filter((i) => i.workspaceId === null);

  for (let i = 0; i < named.length; i += LINE_ITEM_CHUNK) {
    const chunk = named.slice(i, i + LINE_ITEM_CHUNK);
    const valuesSql = sql.join(
      chunk.map(
        (r) =>
          sql`(${r.workspaceId}, ${r.date}, ${r.model}, ${r.costType}, ${r.tokenType}, ${r.contextWindow}, ${r.serviceTier}, ${r.inferenceGeo}, ${r.costMicrocents})`
      ),
      sql`, `
    );
    await db.execute(sql`
      INSERT INTO anthropic_workspace_cost_items
        (workspace_id, date, model, cost_type, token_type, context_window, service_tier, inference_geo, cost_microcents)
      VALUES ${valuesSql}
      ON CONFLICT (workspace_id, date, coalesce(model, ''), coalesce(cost_type, ''), coalesce(token_type, ''), coalesce(context_window, ''), coalesce(service_tier, ''), coalesce(inference_geo, ''))
        WHERE workspace_id IS NOT NULL
      DO UPDATE SET cost_microcents = EXCLUDED.cost_microcents, updated_at = now()
    `);
  }

  for (let i = 0; i < fallback.length; i += LINE_ITEM_CHUNK) {
    const chunk = fallback.slice(i, i + LINE_ITEM_CHUNK);
    const valuesSql = sql.join(
      chunk.map(
        (r) =>
          sql`(NULL, ${r.date}, ${r.model}, ${r.costType}, ${r.tokenType}, ${r.contextWindow}, ${r.serviceTier}, ${r.inferenceGeo}, ${r.costMicrocents})`
      ),
      sql`, `
    );
    await db.execute(sql`
      INSERT INTO anthropic_workspace_cost_items
        (workspace_id, date, model, cost_type, token_type, context_window, service_tier, inference_geo, cost_microcents)
      VALUES ${valuesSql}
      ON CONFLICT (date, coalesce(model, ''), coalesce(cost_type, ''), coalesce(token_type, ''), coalesce(context_window, ''), coalesce(service_tier, ''), coalesce(inference_geo, ''))
        WHERE workspace_id IS NULL
      DO UPDATE SET cost_microcents = EXCLUDED.cost_microcents, updated_at = now()
    `);
  }
}

async function fetchAndUpsertWorkspaceCosts(month: string): Promise<number> {
  // month format: YYYY-MM
  const startDate = `${month}-01T00:00:00Z`;
  const endYear = parseInt(month.slice(0, 4));
  const endMonth = parseInt(month.slice(5, 7));
  const nextMonth = endMonth === 12 ? 1 : endMonth + 1;
  const nextYear = endMonth === 12 ? endYear + 1 : endYear;
  const monthEndDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00Z`;

  // The cost_report API (bucket_width=1d) only returns COMPLETE UTC days. The
  // newest boundary it will honour is the start of today — a `now` or future
  // `ending_at` is silently floored back to start-of-today (verified against
  // the live API). So cap the window there. When there is no complete day in
  // the range yet — i.e. on the 1st of the month, where the month-start equals
  // today — bail out: any request would have ending_at collapse onto
  // starting_at and the API rejects it with 400 "ending date must be after
  // starting date". (#103 capped at the *next* midnight, a future instant the
  // API floors right back to start-of-today, so it still 400'd on the 1st.)
  const now = new Date();
  const startDateObj = new Date(startDate);
  const monthEndDateObj = new Date(monthEndDate);
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const effectiveEnd =
    monthEndDateObj < startOfToday ? monthEndDateObj : startOfToday;
  if (effectiveEnd.getTime() <= startDateObj.getTime()) {
    // No complete day to report yet (1st of the month, or a future month).
    return 0;
  }
  const endDate = effectiveEnd.toISOString();

  const buckets = await retryWithBackoff(() =>
    fetchCostReport(startDate, endDate)
  );

  const lineItems = aggregateCostLineItems(buckets);
  const dailyRows = rollUpLineItems(lineItems);

  await upsertCostLineItems(lineItems);

  // Batch upserts to one statement per partial-index bucket — without batching
  // this loop would issue ~1800 round-trips on a 6-month backfill (rows × days).
  // The two partial unique indexes (workspace_id IS NOT NULL / IS NULL) require
  // two separate ON CONFLICT clauses, hence two batches.
  const namedRows = dailyRows.filter((r) => r.workspaceId !== null);
  const defaultRows = dailyRows.filter((r) => r.workspaceId === null);

  if (namedRows.length > 0) {
    const valuesSql = sql.join(
      namedRows.map(
        (r) => sql`(${r.workspaceId}, ${r.date}, ${r.costCents})`
      ),
      sql`, `
    );
    await db.execute(sql`
      INSERT INTO anthropic_workspace_costs (workspace_id, date, cost_cents)
      VALUES ${valuesSql}
      ON CONFLICT (workspace_id, date) WHERE workspace_id IS NOT NULL
      DO UPDATE SET cost_cents = EXCLUDED.cost_cents, updated_at = now()
    `);
  }

  if (defaultRows.length > 0) {
    const valuesSql = sql.join(
      defaultRows.map((r) => sql`(NULL, ${r.date}, ${r.costCents})`),
      sql`, `
    );
    await db.execute(sql`
      INSERT INTO anthropic_workspace_costs (workspace_id, date, cost_cents)
      VALUES ${valuesSql}
      ON CONFLICT (date) WHERE workspace_id IS NULL
      DO UPDATE SET cost_cents = EXCLUDED.cost_cents, updated_at = now()
    `);
  }

  return namedRows.length + defaultRows.length;
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

      // Stamp the sentinel row so getSyncStatus() (the dashboard's sync pill)
      // reflects this workspace-cost sync. The user-keyed `lastSyncCompletedAt`
      // is owned by the per-user usage sync; this column tracks the cost path.
      if (counts.errorCount === 0) {
        await db
          .insert(anthropicSyncStatus)
          .values({ userId: 0, workspaceSyncCompletedAt: new Date() })
          .onConflictDoUpdate({
            target: [anthropicSyncStatus.userId],
            set: { workspaceSyncCompletedAt: new Date() },
          });
      }

      return counts;
    }
  );
}
