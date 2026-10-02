import type { SyncCounts } from "@/lib/sync/framework";

/**
 * Record a non-fatal finding on a sync run: shown in the sync view, but not
 * counted as an error.
 *
 * The distinction is load-bearing. `errorCount > 0` turns a run's outcome into
 * `partial`, and the cost sync only refreshes the dashboard's "last synced"
 * indicator when a run ends with no errors. Reconciliation always has
 * something to say — project workspaces have spend and no owner by design — so
 * counting its findings as errors marked every run `partial` and froze that
 * indicator at the last run before the findings appeared, making a healthy
 * sync look stopped (045).
 *
 * The message lives in `errorMessage` because that is the field the sync view
 * renders, whatever the outcome.
 *
 * Kept in its own module, free of the database client, so it can be unit
 * tested directly and survives tests that mock the sync framework wholesale.
 */
export function appendSyncWarning(counts: SyncCounts, message: string): void {
  const warning = `Warning: ${message}`;
  counts.errorMessage = counts.errorMessage
    ? `${counts.errorMessage}; ${warning}`
    : warning;
}
