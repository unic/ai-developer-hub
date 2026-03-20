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
  amount: z.object({
    value: z.number(),
    currency: z.string(),
  }),
});

const costBucketSchema = z.object({
  start_time: z.string(),
  end_time: z.string(),
  results: z.array(costResultSchema),
});

const costReportResponseSchema = z.object({
  data: z.array(costBucketSchema),
  has_more: z.boolean(),
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

  // Upsert each workspace
  const now = new Date();
  for (const ws of allWorkspaces) {
    await db
      .insert(anthropicWorkspaces)
      .values({
        workspaceId: ws.id,
        name: ws.name,
        displayColor: ws.display_color,
        isDefault: false,
        isArchived: ws.archived_at !== null,
        archivedAt: ws.archived_at ? new Date(ws.archived_at) : null,
        anthropicCreatedAt: new Date(ws.created_at),
        lastSeenAt: now,
        updatedAt: now,
      })
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

  // Ensure default workspace row exists (workspaceId=null, name="Default Workspace", isDefault=true)
  await db
    .insert(anthropicWorkspaces)
    .values({
      workspaceId: null,
      name: "Default Workspace",
      isDefault: true,
      isArchived: false,
      lastSeenAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      targetWhere: sql`${anthropicWorkspaces.workspaceId} IS NULL`,
      // Use a column that always exists on the table as a no-op conflict target for the partial index
      target: anthropicWorkspaces.isDefault,
      set: {
        lastSeenAt: sql`excluded.last_seen_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });

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

  // Build query string (array params must use [] syntax)
  const parts = [
    "group_by[]=workspace_id",
    `start_date=${startDate}`,
    `end_date=${endDate}`,
    "bucket_width=1d",
  ];

  const baseUrl = "https://api.anthropic.com/v1/organizations/cost_report";
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

  const response = costReportResponseSchema.parse(await res.json());

  // Upsert each (workspaceId, date) pair
  const now = new Date();
  let rowsUpserted = 0;

  for (const bucket of response.data) {
    const date = bucket.start_time.split("T")[0];

    for (const result of bucket.results) {
      const costCents = Math.round(result.amount.value * 100);
      const workspaceId = result.workspace_id;

      if (workspaceId !== null) {
        // Non-null workspace: upsert on (workspaceId, date) partial index
        await db
          .insert(anthropicWorkspaceCosts)
          .values({
            workspaceId,
            date,
            costCents,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [anthropicWorkspaceCosts.workspaceId, anthropicWorkspaceCosts.date],
            targetWhere: sql`${anthropicWorkspaceCosts.workspaceId} IS NOT NULL`,
            set: {
              costCents: sql`excluded.cost_cents`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
      } else {
        // Null workspaceId: upsert on date-only partial index
        await db
          .insert(anthropicWorkspaceCosts)
          .values({
            workspaceId: null,
            date,
            costCents,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: anthropicWorkspaceCosts.date,
            targetWhere: sql`${anthropicWorkspaceCosts.workspaceId} IS NULL`,
            set: {
              costCents: sql`excluded.cost_cents`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
      }

      rowsUpserted++;
    }
  }

  return rowsUpserted;
}

// ---------------------------------------------------------------------------
// T010: syncAnthropicWorkspaces — orchestrator with concurrency guard
// ---------------------------------------------------------------------------

export async function syncAnthropicWorkspaces(
  month?: string
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

  // Check staleness: if workspaceSyncCompletedAt is within last 50 minutes, skip
  if (sentinel?.workspaceSyncCompletedAt) {
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
