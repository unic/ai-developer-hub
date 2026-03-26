import { requireAdmin } from "@/lib/auth-helpers";
import { redirect } from "next/navigation";
import { ApiPreviewClient } from "@/components/settings/api-preview-client";

export default async function ApiPreviewPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/settings/appearance");

  const isConfigured = !!process.env.PROFILE_API_SECRET;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">API Preview</h2>
        <p className="text-muted-foreground">
          Test the profile API endpoint and inspect responses.
        </p>
      </div>
      <ApiPreviewClient isConfigured={isConfigured} />
    </div>
  );
}
