import { withSyncLock, type SyncCounts } from "@/lib/sync/framework";
import { db } from "@/lib/db";
import {
  githubConnections,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { syncBillingData, syncSeatAssignments, syncUsageMetrics } from "@/lib/copilot-sync";
import { decryptApiKey } from "@/lib/crypto";

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
      sourceType: "github_copilot_billing",
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

      // Find active connection with Copilot sync enabled
      const connection = await db.query.githubConnections.findFirst({
        where: and(
          eq(githubConnections.status, "active"),
          eq(githubConnections.copilotSyncEnabled, true)
        ),
      });

      if (!connection) {
        counts.errorCount = 1;
        counts.errorMessage = "No active connection with Copilot sync enabled";
        return counts;
      }

      let token: string;
      try {
        token = await decryptApiKey(connection.tokenEncrypted);
      } catch {
        counts.errorCount = 1;
        counts.errorMessage = "Failed to decrypt connection token";
        return counts;
      }

      const syncConnection = {
        id: connection.id,
        orgLogin: connection.orgLogin,
      };

      const errors: string[] = [];

      // Sync billing data
      try {
        const billingResult = await syncBillingData(
          syncConnection,
          token
        );
        counts.createdCount += billingResult.billingProcessed;
      } catch (err) {
        errors.push(
          `Billing sync failed: ${err instanceof Error ? err.message : String(err)}`
        );
        counts.errorCount++;
      }

      // Sync seat assignments
      try {
        const seatResult = await syncSeatAssignments(syncConnection, token);
        counts.updatedCount += seatResult.seatsProcessed;
      } catch (err) {
        errors.push(
          `Seat sync failed: ${err instanceof Error ? err.message : String(err)}`
        );
        counts.errorCount++;
      }

      // Sync usage metrics
      try {
        const metricsResult = await syncUsageMetrics(syncConnection, token, {
          backfillStartDate: opts?.backfillStartDate,
        });
        counts.updatedCount += metricsResult.metricsProcessed;
      } catch (err) {
        errors.push(
          `Metrics sync failed: ${err instanceof Error ? err.message : String(err)}`
        );
        counts.errorCount++;
      }

      if (errors.length > 0) {
        counts.errorMessage = errors.join("; ");
      }

      return counts;
    }
  );
}
