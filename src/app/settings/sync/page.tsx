import { Suspense } from "react";
import { getSyncStatus, getSyncHistory } from "@/actions/sync";
import { requireAdmin } from "@/lib/auth-helpers";
import { redirect } from "next/navigation";
import { SyncDashboard } from "./sync-dashboard";
import { LoadingState, InlineSpinner } from "@/components/ui/loading-state";

export default async function SyncSettingsPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/settings");

  const [statusResult, historyResult] = await Promise.all([
    getSyncStatus(),
    getSyncHistory({ triggerType: "manual", limit: 20 }),
  ]);

  if (!statusResult.success) {
    return <div className="text-destructive">Error: {statusResult.error}</div>;
  }

  if (!historyResult.success) {
    return (
      <div className="text-destructive">Error: {historyResult.error}</div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-medium tracking-tight text-ink">Sync Status</h2>
        <p className="text-muted-foreground">
          Monitor and manage all data synchronization sources.
        </p>
      </div>
      <Suspense fallback={<LoadingState label="LOADING" />}>
        <SyncDashboard
          initialSources={statusResult.data}
          initialManualEvents={historyResult.data}
        />
      </Suspense>
    </div>
  );
}
