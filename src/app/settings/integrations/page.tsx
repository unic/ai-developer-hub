import { getActiveGitHubConnection } from "@/actions/github";
import { getSyncHistory } from "@/actions/github-sync";
import { GitHubIntegrationClient } from "./github-integration-client";

export default async function IntegrationsPage() {
  const connectionResult = await getActiveGitHubConnection();
  const historyResult = await getSyncHistory();

  const connection =
    connectionResult.success ? connectionResult.data.connection : null;
  const syncHistory =
    historyResult.success ? historyResult.data.events : [];

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
      />
    </div>
  );
}
