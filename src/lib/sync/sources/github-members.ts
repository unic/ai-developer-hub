import { withSyncLock, type SyncCounts } from "@/lib/sync/framework";

interface RunOptions {
  force?: boolean;
  counts?: SyncCounts;
}

/**
 * GitHub member sync source for the unified framework.
 *
 * Note: The actual member sync is interactive (requires preview + confirmation),
 * so this wrapper is used for tracking completed syncs in the unified event log.
 * Call `run()` with pre-computed counts after `confirmGitHubSync()` completes.
 */
export async function run(
  triggeredBy?: number,
  opts?: RunOptions
): Promise<{ eventId: number }> {
  return withSyncLock(
    {
      sourceType: "github_members",
      triggeredBy,
      operationType: "regular",
    },
    async (eventId) => {
      // If pre-computed counts are provided (from confirmGitHubSync),
      // return them directly. Otherwise return zeros.
      return opts?.counts ?? {
        createdCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        errorCount: 0,
      };
    }
  );
}
