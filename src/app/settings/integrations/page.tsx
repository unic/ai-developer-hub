import { requireAdmin } from "@/lib/auth-helpers";
import { redirect } from "next/navigation";
import { getActiveGitHubConnection } from "@/actions/github";
import { checkAnthropicStatus } from "@/actions/anthropic-status";
import { GitHubIntegrationClient } from "./github-integration-client";
import { ClaudeCodeStatusCard } from "./claude-code-status-card";

export default async function IntegrationsPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/settings/appearance");

  // Fetch independent data in parallel
  const [connectionResult, anthropicResult] = await Promise.all([
    getActiveGitHubConnection(),
    checkAnthropicStatus(),
  ]);

  const connection =
    connectionResult.success ? connectionResult.data.connection : null;

  const anthropicStatus = anthropicResult.success
    ? anthropicResult.data
    : { connected: false, workspaceName: null, lastCheckedAt: new Date().toISOString() };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-medium tracking-tight text-ink">Integrations</h1>
        <p className="text-muted-foreground">
          Connect external services to enrich user data.
        </p>
      </div>

      <GitHubIntegrationClient initialConnection={connection} />

      <ClaudeCodeStatusCard
        connected={anthropicStatus.connected}
        workspaceName={anthropicStatus.workspaceName}
        lastCheckedAt={anthropicStatus.lastCheckedAt}
      />
    </div>
  );
}
