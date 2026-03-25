import { Suspense } from "react";
import { getSyncStatus, getSyncHistory } from "@/actions/sync";
import { requireAdmin } from "@/lib/auth-helpers";
import { redirect } from "next/navigation";
import { SyncDashboard } from "./sync-dashboard";

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
        <h2 className="text-2xl font-semibold tracking-tight">Sync Status</h2>
        <p className="text-muted-foreground">
          Monitor and manage all data synchronization sources.
        </p>
      </div>
      <Suspense
        fallback={<div className="animate-pulse h-64 bg-muted rounded-md" />}
      >
        <SyncDashboard
          initialSources={statusResult.data}
          initialManualEvents={historyResult.data}
        />
      </Suspense>
    </div>
  );
}
