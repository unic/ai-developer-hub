import { withSyncLock, retryWithBackoff, type SyncCounts } from "@/lib/sync/framework";
import {
  runAnthropicSyncCore,
  fetchAnthropicUsage,
  resolveAllMappings,
  prepareUsageRow,
  batchUpsertUsageRows,
} from "@/lib/anthropic-sync";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { unknownModelMessage } from "@/lib/anthropic/reconciliation";

/**
 * Name the models the price table cannot price.
 *
 * `pricing_resolved` has been set on every affected row since 016 and nothing
 * ever read it — which is how a 7.59x overstatement ran for a month. This
 * turns that flag into a sync event an admin actually sees.
 */
async function unknownModelWarning(
  sinceDays = 31,
): Promise<string | null> {
  const rows = (
    await db.execute(sql`
      SELECT DISTINCT model
      FROM anthropic_usage_metrics
      WHERE pricing_resolved = false
        AND date >= (CURRENT_DATE - ${sinceDays}::int)
      ORDER BY model
    `)
  ).rows as { model: string }[];

  if (rows.length === 0) return null;
  return unknownModelMessage(rows.map((r) => r.model));
}

const WINDOW_DAYS = 31; // Anthropic API max per-request window

interface RunOptions {
  force?: boolean;
  backfillStartDate?: Date;
}

export async function run(
  triggeredBy?: number,
  opts?: RunOptions
): Promise<{ eventId: number }> {
  return withSyncLock(
    {
      sourceType: "anthropic_api_usage",
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

      // Regular sync — delegate to core sync logic (no inner lock, framework handles locking)
      if (!opts?.backfillStartDate) {
        try {
          const summary = await retryWithBackoff(() => runAnthropicSyncCore());
          counts.createdCount = summary.syncedUsers;
          counts.updatedCount = summary.syncedDays;
          counts.skippedCount = summary.skippedUsers;
          counts.errorCount = summary.errors.length;

          if (summary.errors.length > 0) {
            counts.errorMessage = summary.errors
              .map((e) => e.error)
              .join("; ")
              .slice(0, 1000);
          }

          // Non-fatal: the rows are written either way, but a model the price
          // table does not know is a number nobody should trust.
          const unknown = await unknownModelWarning();
          if (unknown) {
            const warning = `Warning: ${unknown}`;
            counts.errorCount += 1;
            counts.errorMessage = counts.errorMessage
              ? `${counts.errorMessage}; ${warning}`.slice(0, 1000)
              : warning.slice(0, 1000);
          }
        } catch (err) {
          counts.errorCount = 1;
          counts.errorMessage =
            err instanceof Error ? err.message : String(err);
        }
        return counts;
      }

      // Backfill mode — iterate in 31-day windows from startDate to today
      try {
        const apiKeyToUser = await resolveAllMappings();
        if (apiKeyToUser.size === 0) {
          counts.errorMessage = "No users with resolved API keys";
          return counts;
        }

        const startDate = opts.backfillStartDate;
        const now = new Date();
        now.setUTCHours(0, 0, 0, 0);

        let windowStart = new Date(startDate);
        windowStart.setUTCHours(0, 0, 0, 0);

        while (windowStart <= now) {
          const windowEnd = new Date(windowStart);
          windowEnd.setUTCDate(windowEnd.getUTCDate() + WINDOW_DAYS);
          if (windowEnd > now) {
            windowEnd.setTime(now.getTime());
            windowEnd.setUTCDate(windowEnd.getUTCDate() + 1);
          }

          const startingAt = windowStart.toISOString().replace(/\.\d+Z$/, "Z");
          const endingAt = windowEnd.toISOString().replace(/\.\d+Z$/, "Z");

          const response = await retryWithBackoff(() =>
            fetchAnthropicUsage(startingAt, endingAt)
          );

          const pendingRows: NonNullable<ReturnType<typeof prepareUsageRow>>[] = [];
          const syncedDates = new Set<string>();

          for (const bucket of response.data) {
            const bucketDate = bucket.starting_at.split("T")[0];
            for (const result of bucket.results) {
              const apiKeyId = result.api_key_id;
              const model = result.model;
              if (!apiKeyId || !model) continue;
              const userId = apiKeyToUser.get(apiKeyId);
              if (!userId) continue;

              syncedDates.add(bucketDate);
              const row = prepareUsageRow(userId, bucketDate, result);
              if (row) pendingRows.push(row);
            }
          }

          if (pendingRows.length > 0) {
            await batchUpsertUsageRows(pendingRows);
          }

          counts.updatedCount += syncedDates.size;
          windowStart = new Date(windowEnd);
        }

        counts.createdCount = apiKeyToUser.size;
      } catch (err) {
        counts.errorCount++;
        counts.errorMessage =
          err instanceof Error ? err.message : String(err);
      }

      return counts;
    }
  );
}
