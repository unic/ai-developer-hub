import { AuthGuard } from "@/components/auth-guard";
import {
  listMessageTemplates,
  listToolsWithTiers,
} from "@/actions/license-templates";
import { TemplatesClient } from "./templates-client";

export default async function LicenseTemplatesPage() {
  const [templates, toolsWithTiers] = await Promise.all([
    listMessageTemplates(),
    listToolsWithTiers(),
  ]);

  return (
    <AuthGuard requiredRole="admin">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">License Templates</h1>
          <p className="text-muted-foreground">
            Approval and completion messages, customizable per tool and per tier.
            Tool defaults are inherited unless a tier override exists.
          </p>
        </div>
        <TemplatesClient templates={templates} toolsWithTiers={toolsWithTiers} />
      </div>
    </AuthGuard>
  );
}
