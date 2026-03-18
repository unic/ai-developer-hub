import { requireAdmin } from "@/lib/auth-helpers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { anthropicSyncStatus } from "@/lib/db/schema";
import { getActiveGitHubConnection } from "@/actions/github";
import { getSyncHistory } from "@/actions/github-sync";
import { getCopilotSyncStatus } from "@/actions/copilot";
import { GitHubIntegrationClient } from "./github-integration-client";
import { ClaudeSyncSection } from "@/components/claude-sync-section";

export default async function IntegrationsPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/settings/appearance");

  // Fetch independent data in parallel
  const [connectionResult, historyResult, anthropicStatus] = await Promise.all([
    getActiveGitHubConnection(),
    getSyncHistory(),
    db.query.anthropicSyncStatus.findFirst({
      where: eq(anthropicSyncStatus.userId, 0),
    }),
  ]);

  const connection =
    connectionResult.success ? connectionResult.data.connection : null;
  const syncHistory =
    historyResult.success ? historyResult.data.events : [];

  // Copilot status depends on connection existing
  let copilotStatus = {
    enabled: false,
    lastSyncAt: null as string | null,
    lastSyncStatus: null as "completed" | "partial" | "failed" | null,
    nextScheduledSync: null as string | null,
    dataRange: null as { earliest: string; latest: string } | null,
    recordCounts: { metrics: 0, billing: 0, seats: 0 },
  };

  if (connection) {
    const statusResult = await getCopilotSyncStatus();
    if (statusResult.success) {
      copilotStatus = statusResult.data;
    }
  }

  const claudeSyncStatus = {
    lastSyncCompletedAt: anthropicStatus?.lastSyncCompletedAt?.toISOString() ?? null,
    lastSyncError: anthropicStatus?.lastSyncError ?? null,
    syncedDays: anthropicStatus?.syncedDays ?? 0,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Integrations</h1>
        <p className="text-muted-foreground">
          Connect external services to enrich user data.
        </p>
      </div>

      <GitHubIntegrationClient
        initialConnection={connection}
        initialSyncHistory={syncHistory}
        copilotStatus={copilotStatus}
      />

      <ClaudeSyncSection initialStatus={claudeSyncStatus} />
    </div>
  );
}
