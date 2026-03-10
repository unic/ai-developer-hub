/**
 * Reset all Copilot sync data so you can test the sync process from scratch.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/reset-copilot-sync.ts
 *
 * What it does (in order):
 *   1. Deletes copilot_usage_metrics rows
 *   2. Deletes billed_costs with vendor_reference matching 'copilot-billing-%'
 *   3. Deletes copilot_billing_snapshots rows
 *   4. Deletes license_assignments where source = 'copilot-sync'
 *   5. Deletes github_sync_events where sync_type = 'copilot'
 *   6. Resets copilotSyncEnabled = false on github_connections
 *
 * It does NOT delete:
 *   - The "GitHub Copilot" ai_tools row or its access tiers
 *   - Manual license assignments (source = 'manual')
 *   - GitHub connection itself or member sync data
 */

import { db } from "../src/lib/db";
import {
  copilotUsageMetrics,
  copilotBillingSnapshots,
  licenseAssignments,
  githubSyncEvents,
  githubConnections,
  billedCosts,
} from "../src/lib/db/schema";
import { eq, like } from "drizzle-orm";

async function main() {
  console.log("Resetting Copilot sync data...\n");

  // 1. Delete usage metrics
  const metricsDeleted = await db
    .delete(copilotUsageMetrics)
    .returning({ id: copilotUsageMetrics.id });
  console.log(`  Deleted ${metricsDeleted.length} usage metric rows`);

  // 2. Delete billed costs created by copilot sync (identified by vendor reference)
  const costsDeleted = await db
    .delete(billedCosts)
    .where(like(billedCosts.vendorReference, "copilot-billing-%"))
    .returning({ id: billedCosts.id });
  console.log(`  Deleted ${costsDeleted.length} copilot-sourced billed cost rows`);

  // 3. Delete billing snapshots
  const billDeleted = await db
    .delete(copilotBillingSnapshots)
    .returning({ id: copilotBillingSnapshots.id });
  console.log(`  Deleted ${billDeleted.length} billing snapshot rows`);

  // 4. Delete copilot-sync license assignments
  const assignDeleted = await db
    .delete(licenseAssignments)
    .where(eq(licenseAssignments.source, "copilot-sync"))
    .returning({ id: licenseAssignments.id });
  console.log(`  Deleted ${assignDeleted.length} copilot-sync license assignments`);

  // 5. Delete copilot sync events
  const eventsDeleted = await db
    .delete(githubSyncEvents)
    .where(eq(githubSyncEvents.syncType, "copilot"))
    .returning({ id: githubSyncEvents.id });
  console.log(`  Deleted ${eventsDeleted.length} copilot sync events`);

  // 6. Reset copilotSyncEnabled on all connections
  const connectionsReset = await db
    .update(githubConnections)
    .set({ copilotSyncEnabled: false })
    .where(eq(githubConnections.copilotSyncEnabled, true))
    .returning({ id: githubConnections.id });
  console.log(`  Reset copilotSyncEnabled on ${connectionsReset.length} connection(s)`);

  console.log("\nDone. You can now re-enable Copilot sync from Settings > Integrations.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Reset failed:", err);
  process.exit(1);
});
