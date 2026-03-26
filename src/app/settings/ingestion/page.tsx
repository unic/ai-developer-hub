import { getIngestionHistory } from "@/actions/ingestion-log";
import { requireAdmin } from "@/lib/auth-helpers";
import { redirect } from "next/navigation";
import { IngestionHistoryTable } from "./ingestion-history-table";

export default async function IngestionSettingsPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/settings");

  const result = await getIngestionHistory();

  if (!result.success) {
    return <div className="text-destructive">Error: {result.error}</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Ingestion</h2>
        <p className="text-muted-foreground">
          View the history of all ingested billing documents across sources.
        </p>
      </div>
      <IngestionHistoryTable data={result.data} />
    </div>
  );
}
