import { withSyncLock, retryWithBackoff, type SyncCounts } from "@/lib/sync/framework";
import { runAnthropicSync } from "@/lib/anthropic-sync";

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

      try {
        const summary = await retryWithBackoff(() => runAnthropicSync());
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
      } catch (err) {
        counts.errorCount = 1;
        counts.errorMessage =
          err instanceof Error ? err.message : String(err);
      }

      return counts;
    }
  );
}
