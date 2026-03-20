import { db } from "@/lib/db";
import {
  anthropicWorkspaces,
  anthropicWorkspaceCosts,
  anthropicSyncStatus,
} from "@/lib/db/schema";
import { eq, sql, isNull } from "drizzle-orm";
import { ANTHROPIC_API_VERSION } from "@/lib/anthropic-constants";
import { revalidateTag, revalidatePath } from "next/cache";
import { z } from "zod";
import { startOfMonth, endOfMonth, format } from "date-fns";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORKSPACE_SENTINEL_USER_ID = -1;
const WORKSPACE_COOLDOWN_MS = 50 * 60 * 1000; // 50 minutes

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  created_at: z.string(),
  archived_at: z.string().nullable(),
  display_color: z.string().nullable(),
});

const workspacesResponseSchema = z.object({
  data: z.array(workspaceSchema),
  has_more: z.boolean(),
  last_id: z.string().nullable(),
});

const costResultSchema = z.object({
  workspace_id: z.string().nullable(),
  amount: z.string(), // USD value as a decimal string e.g. "1.2345"
});

const costBucketSchema = z.object({
  starting_at: z.string(),
  ending_at: z.string(),
  results: z.array(costResultSchema),
});

const costReportResponseSchema = z.object({
  data: z.array(costBucketSchema),
  has_more: z.boolean(),
  next_page: z.string().nullable().optional(),
});

// ---------------------------------------------------------------------------
// T008: fetchAndUpsertWorkspaces
// ---------------------------------------------------------------------------

export async function fetchAndUpsertWorkspaces(): Promise<number> {
  const adminKey = process.env.ANTHROPIC_ADMIN_API_KEY;
  if (!adminKey) throw new Error("ANTHROPIC_ADMIN_API_KEY is not set");

  const allWorkspaces: z.infer<typeof workspaceSchema>[] = [];
  let lastId: string | null = null;

  do {
    const url = new URL("https://api.anthropic.com/v1/organizations/workspaces");
    url.searchParams.set("limit", "100");
    if (lastId) {
      url.searchParams.set("after_id", lastId);
    }

    const res = await fetch(url.toString(), {
      headers: {
        "x-api-key": adminKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic workspaces API error ${res.status}: ${body}`);
    }

    const page = workspacesResponseSchema.parse(await res.json());
    allWorkspaces.push(...page.data);

    if (page.has_more && page.last_id) {
      lastId = page.last_id;
    } else {
      lastId = null;
    }
  } while (lastId !== null);

  // Batch upsert all workspaces in a single statement
  const now = new Date();
  if (allWorkspaces.length > 0) {
    await db
      .insert(anthropicWorkspaces)
      .values(
        allWorkspaces.map((ws) => ({
          workspaceId: ws.id,
          name: ws.name,
          displayColor: ws.display_color,
          isDefault: false,
          isArchived: ws.archived_at !== null,
          archivedAt: ws.archived_at ? new Date(ws.archived_at) : null,
          anthropicCreatedAt: new Date(ws.created_at),
          lastSeenAt: now,
          updatedAt: now,
        }))
      )
      .onConflictDoUpdate({
        target: anthropicWorkspaces.workspaceId,
        targetWhere: sql`${anthropicWorkspaces.workspaceId} IS NOT NULL`,
        set: {
          name: sql`excluded.name`,
          displayColor: sql`excluded.display_color`,
          isArchived: sql`excluded.is_archived`,
          archivedAt: sql`excluded.archived_at`,
          lastSeenAt: sql`excluded.last_seen_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  // Ensure default workspace row exists (workspaceId=null, name="Default Workspace", isDefault=true).
  // Avoid ON CONFLICT partial-index targeting (Drizzle generates wrong WHERE clause).
  // Simple read-then-write: no partial index required.
  const existingDefault = await db.query.anthropicWorkspaces.findFirst({
    where: isNull(anthropicWorkspaces.workspaceId),
  });
  if (existingDefault) {
    await db
      .update(anthropicWorkspaces)
      .set({ lastSeenAt: now, updatedAt: now })
      .where(isNull(anthropicWorkspaces.workspaceId));
  } else {
    await db.insert(anthropicWorkspaces).values({
      workspaceId: null,
      name: "Default Workspace",
      isDefault: true,
      isArchived: false,
      lastSeenAt: now,
      updatedAt: now,
    });
  }

  return allWorkspaces.length;
}

// ---------------------------------------------------------------------------
// T009: fetchAndUpsertWorkspaceCosts
// ---------------------------------------------------------------------------

export async function fetchAndUpsertWorkspaceCosts(
  month?: string
): Promise<number> {
  const adminKey = process.env.ANTHROPIC_ADMIN_API_KEY;
  if (!adminKey) throw new Error("ANTHROPIC_ADMIN_API_KEY is not set");

  // Compute month range
  let refDate: Date;
  if (month) {
    // month is expected in YYYY-MM format
    refDate = new Date(`${month}-01T00:00:00Z`);
  } else {
    refDate = new Date();
  }

  const startDate = format(startOfMonth(refDate), "yyyy-MM-dd");
  const endDate = format(endOfMonth(refDate), "yyyy-MM-dd");

  // Build base query string (array params must use [] syntax)
  const baseParts = [
    "group_by[]=workspace_id",
    `starting_at=${encodeURIComponent(startDate)}`,
    `ending_at=${encodeURIComponent(endDate)}`,
    "bucket_width=1d",
  ];

  const baseUrl = "https://api.anthropic.com/v1/organizations/cost_report";

  // Paginate through all result pages (cost_report uses next_page cursor)
  const allBuckets: z.infer<typeof costBucketSchema>[] = [];
  let nextPage: string | null = null;
  let pageCount = 0;

  do {
    const parts = nextPage
      ? [...baseParts, `page=${encodeURIComponent(nextPage)}`]
      : baseParts;

    const res = await fetch(`${baseUrl}?${parts.join("&")}`, {
      headers: {
        "x-api-key": adminKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic cost_report API error ${res.status}: ${body}`);
    }

    const page = costReportResponseSchema.parse(await res.json());
    allBuckets.push(...page.data);
    pageCount++;
    nextPage = page.has_more && page.next_page ? page.next_page : null;
  } while (nextPage);

  // Collect rows into two buckets for batch upserts
  const now = new Date();
  let rowsUpserted = 0;

  const namedRows: { workspaceId: string; date: string; costCents: number; updatedAt: Date }[] = [];
  const defaultRows: { workspaceId: null; date: string; costCents: number; updatedAt: Date }[] = [];

  for (const bucket of allBuckets) {
    const date = bucket.starting_at.split("T")[0];
    for (const result of bucket.results) {
      const costCents = Math.round(parseFloat(result.amount) * 100);
      if (result.workspace_id !== null) {
        namedRows.push({ workspaceId: result.workspace_id, date, costCents, updatedAt: now });
      } else {
        defaultRows.push({ workspaceId: null, date, costCents, updatedAt: now });
      }
      rowsUpserted++;
    }
  }

  // Diagnostic: log API response summary — check Vercel/server logs after sync
  const apiTotalCents = [...namedRows, ...defaultRows].reduce((s, r) => s + r.costCents, 0);
  console.log(
    `[workspace-costs] ${pageCount} page(s), ${allBuckets.length} buckets, ${rowsUpserted} results. ` +
    `API total: $${(apiTotalCents / 100).toFixed(2)} ` +
    `(named=${namedRows.length} $${(namedRows.reduce((s,r)=>s+r.costCents,0)/100).toFixed(2)}, ` +
    `default=${defaultRows.length} $${(defaultRows.reduce((s,r)=>s+r.costCents,0)/100).toFixed(2)})`
  );
  // Log raw amount values from first few results for unit diagnosis
  const sampleResults = allBuckets.slice(0, 3).flatMap(b =>
    b.results.map(r => ({ date: b.starting_at.split("T")[0], ws: r.workspace_id, amount: r.amount }))
  );
  console.log("[workspace-costs] Sample results (raw amounts):", JSON.stringify(sampleResults, null, 2));

  // Use raw SQL upserts to correctly target partial indexes.
  // Drizzle generates incorrect WHERE clauses for partial-index ON CONFLICT,
  // causing inserts instead of updates (30× overcount bug).
  for (const row of namedRows) {
    await db.execute(sql`
      INSERT INTO anthropic_workspace_costs (workspace_id, date, cost_cents, updated_at)
      VALUES (${row.workspaceId}, ${row.date}::date, ${row.costCents}, ${row.updatedAt})
      ON CONFLICT (workspace_id, date) WHERE workspace_id IS NOT NULL
      DO UPDATE SET cost_cents = EXCLUDED.cost_cents, updated_at = EXCLUDED.updated_at
    `);
  }

  for (const row of defaultRows) {
    await db.execute(sql`
      INSERT INTO anthropic_workspace_costs (workspace_id, date, cost_cents, updated_at)
      VALUES (NULL, ${row.date}::date, ${row.costCents}, ${row.updatedAt})
      ON CONFLICT (date) WHERE workspace_id IS NULL
      DO UPDATE SET cost_cents = EXCLUDED.cost_cents, updated_at = EXCLUDED.updated_at
    `);
  }

  return rowsUpserted;
}

// ---------------------------------------------------------------------------
// T010: syncAnthropicWorkspaces — orchestrator with concurrency guard
// ---------------------------------------------------------------------------

export async function syncAnthropicWorkspaces(
  month?: string,
  force = false
): Promise<{ skipped: true } | { success: true; workspacesUpserted: number; costRowsUpserted: number }> {
  // Ensure sentinel row exists (userId=-1)
  await db
    .insert(anthropicSyncStatus)
    .values({ userId: WORKSPACE_SENTINEL_USER_ID })
    .onConflictDoNothing({ target: [anthropicSyncStatus.userId] });

  // Read sentinel row
  const sentinel = await db.query.anthropicSyncStatus.findFirst({
    where: eq(anthropicSyncStatus.userId, WORKSPACE_SENTINEL_USER_ID),
  });

  // Check staleness: if workspaceSyncCompletedAt is within last 50 minutes, skip (unless forced)
  if (!force && sentinel?.workspaceSyncCompletedAt) {
    const completedAt = sentinel.workspaceSyncCompletedAt.getTime();
    const now = Date.now();
    if (now - completedAt < WORKSPACE_COOLDOWN_MS) {
      return { skipped: true };
    }
  }

  // Set lastSyncStartedAt on sentinel row
  await db
    .update(anthropicSyncStatus)
    .set({ lastSyncStartedAt: new Date(), lastSyncError: null })
    .where(eq(anthropicSyncStatus.userId, WORKSPACE_SENTINEL_USER_ID));

  try {
    const workspacesUpserted = await fetchAndUpsertWorkspaces();
    const costRowsUpserted = await fetchAndUpsertWorkspaceCosts(month);

    // Update sentinel row with completion timestamps
    const completedAt = new Date();
    await db
      .update(anthropicSyncStatus)
      .set({
        lastSyncCompletedAt: completedAt,
        workspaceSyncCompletedAt: completedAt,
        lastSyncError: null,
      })
      .where(eq(anthropicSyncStatus.userId, WORKSPACE_SENTINEL_USER_ID));

    revalidateTag("anthropic-workspace-costs");
    revalidateTag("alerts");
    revalidatePath("/claude");

    return { success: true, workspacesUpserted, costRowsUpserted };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await db
      .update(anthropicSyncStatus)
      .set({ lastSyncError: errorMsg.slice(0, 500) })
      .where(eq(anthropicSyncStatus.userId, WORKSPACE_SENTINEL_USER_ID));
    throw err;
  }
}
