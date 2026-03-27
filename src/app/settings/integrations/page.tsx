import { requireAdmin } from "@/lib/auth-helpers";
import { redirect } from "next/navigation";
import { getActiveGitHubConnection } from "@/actions/github";
import { getPlanConnections } from "@/actions/plan-connections";
import { GitHubIntegrationClient } from "./github-integration-client";
import { PlanConnectionsCard } from "@/components/settings/plan-connections-card";

export default async function IntegrationsPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/settings/appearance");

  // Fetch independent data in parallel
  const [connectionResult, planResult] = await Promise.all([
    getActiveGitHubConnection(),
    getPlanConnections(),
  ]);

  const connection =
    connectionResult.success ? connectionResult.data.connection : null;

  const planConnections = planResult.success ? planResult.data : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Integrations</h1>
        <p className="text-muted-foreground">
          Connect external services to enrich user data.
        </p>
      </div>

      <GitHubIntegrationClient initialConnection={connection} />

      <PlanConnectionsCard initialConnections={planConnections} />
    </div>
  );
}
