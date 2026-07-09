import { AuthGuard } from "@/components/auth-guard";
import { listToolMappings } from "@/actions/tool-mappings";
import { listToolsWithTiers } from "@/actions/license-templates";
import { ToolMappingClient } from "./tool-mapping-client";

export default async function ToolMappingPage() {
  const [mappings, toolsWithTiers] = await Promise.all([
    listToolMappings(),
    listToolsWithTiers(),
  ]);

  return (
    <AuthGuard requiredRole="admin">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-medium tracking-tight text-ink">Tool Mapping</h1>
          <p className="text-muted-foreground">
            How role + profile from the request form resolve to a proposed tool
            (per the AI Tooling Guide). Approvers can always override on the
            request itself. Deleting a row degrades that pair to &quot;needs
            decision&quot; — ingest never fails on a missing mapping.
          </p>
        </div>
        <ToolMappingClient mappings={mappings} toolsWithTiers={toolsWithTiers} />
      </div>
    </AuthGuard>
  );
}
