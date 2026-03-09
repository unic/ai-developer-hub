import { requireAdmin } from "@/lib/auth-helpers";
import { redirect } from "next/navigation";
import { getActiveGitHubConnection } from "@/actions/github";
import { getSyncHistory } from "@/actions/github-sync";
import { getCopilotSyncStatus } from "@/actions/copilot";
import { GitHubIntegrationClient } from "./github-integration-client";

export default async function IntegrationsPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/settings/appearance");

  const connectionResult = await getActiveGitHubConnection();
  const historyResult = await getSyncHistory();

  const connection =
    connectionResult.success ? connectionResult.data.connection : null;
  const syncHistory =
    historyResult.success ? historyResult.data.events : [];

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
    </div>
  );
}
