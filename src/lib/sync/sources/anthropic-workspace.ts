import { withSyncLock, retryWithBackoff, type SyncCounts } from "@/lib/sync/framework";
import { db } from "@/lib/db";
import { anthropicWorkspaces, anthropicWorkspaceCosts } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { ANTHROPIC_API_VERSION } from "@/lib/anthropic-constants";

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

const costReportItemSchema = z.object({
  workspace_id: z.string().nullable().optional(),
  workspace_name: z.string().nullable().optional(),
  cost_cents: z.number(),
});

const costReportResponseSchema = z.object({
  data: z.array(costReportItemSchema),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchWorkspaces(): Promise<z.infer<typeof workspacesResponseSchema>> {
  const adminKey = process.env.ANTHROPIC_ADMIN_API_KEY;
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
): Promise<z.infer<typeof costReportResponseSchema>> {
  const adminKey = process.env.ANTHROPIC_ADMIN_API_KEY;
  if (!adminKey) throw new Error("ANTHROPIC_ADMIN_API_KEY is not set");

  const query = [
    `starting_at=${encodeURIComponent(startingAt)}`,
    `ending_at=${encodeURIComponent(endingAt)}`,
    "group_by[]=workspace",
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

  return costReportResponseSchema.parse(await res.json());
}

async function fetchAndUpsertWorkspaces(): Promise<number> {
  const response = await retryWithBackoff(() => fetchWorkspaces());
  let upserted = 0;

  for (const ws of response.data) {
    await db
      .insert(anthropicWorkspaces)
      .values({
        workspaceId: ws.id,
        name: ws.name,
        isDefault: ws.is_default,
        isArchived: ws.is_archived,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [anthropicWorkspaces.workspaceId],
        set: {
          name: ws.name,
          isDefault: ws.is_default,
          isArchived: ws.is_archived,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
      });
    upserted++;
  }

  return upserted;
}

async function fetchAndUpsertWorkspaceCosts(month: string): Promise<number> {
  // month format: YYYY-MM
  const startDate = `${month}-01T00:00:00Z`;
  const endYear = parseInt(month.slice(0, 4));
  const endMonth = parseInt(month.slice(5, 7));
  const nextMonth = endMonth === 12 ? 1 : endMonth + 1;
  const nextYear = endMonth === 12 ? endYear + 1 : endYear;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00Z`;

  const response = await retryWithBackoff(() =>
    fetchCostReport(startDate, endDate)
  );

  let upserted = 0;
  const dateStr = `${month}-01`;

  for (const item of response.data) {
    if (item.workspace_id) {
      await db
        .insert(anthropicWorkspaceCosts)
        .values({
          workspaceId: item.workspace_id,
          date: dateStr,
          costCents: item.cost_cents,
        })
        .onConflictDoUpdate({
          target: [anthropicWorkspaceCosts.workspaceId, anthropicWorkspaceCosts.date],
          set: {
            costCents: item.cost_cents,
            updatedAt: new Date(),
          },
          setWhere: sql`${anthropicWorkspaceCosts.workspaceId} IS NOT NULL`,
        });
    } else {
      // Default workspace (null workspace_id)
      await db.execute(sql`
        INSERT INTO anthropic_workspace_costs (workspace_id, date, cost_cents)
        VALUES (NULL, ${dateStr}, ${item.cost_cents})
        ON CONFLICT (date) WHERE workspace_id IS NULL
        DO UPDATE SET cost_cents = ${item.cost_cents}, updated_at = now()
      `);
    }
    upserted++;
  }

  return upserted;
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
      sourceType: "anthropic_workspace_sync",
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

      try {
        // Sync workspace metadata
        counts.createdCount = await fetchAndUpsertWorkspaces();
      } catch (err) {
        counts.errorCount++;
        counts.errorMessage = `Workspace metadata sync failed: ${err instanceof Error ? err.message : String(err)}`;
        return counts;
      }

      try {
        if (opts?.backfillStartDate) {
          // Backfill: iterate month by month
          const start = opts.backfillStartDate;
          const now = new Date();
          const current = new Date(start.getUTCFullYear(), start.getUTCMonth(), 1);

          while (current <= now) {
            const month = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}`;
            counts.updatedCount += await fetchAndUpsertWorkspaceCosts(month);
            current.setUTCMonth(current.getUTCMonth() + 1);
          }
        } else {
          // Regular sync: current month only
          const month = opts?.month ??
            `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;
          counts.updatedCount = await fetchAndUpsertWorkspaceCosts(month);
        }
      } catch (err) {
        counts.errorCount++;
        const msg = err instanceof Error ? err.message : String(err);
        counts.errorMessage = counts.errorMessage
          ? `${counts.errorMessage}; Cost sync failed: ${msg}`
          : `Cost sync failed: ${msg}`;
      }

      return counts;
    }
  );
}
