import { getIngestionHistory } from "@/actions/ingestion-log";
import { getIngestionFilters } from "@/actions/ingestion-filters";
import { requireAdmin } from "@/lib/auth-helpers";
import { redirect } from "next/navigation";
import { IngestionHistoryTable } from "./ingestion-history-table";
import { IngestionFiltersSection } from "./ingestion-filters-section";

export default async function IngestionSettingsPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/settings");

  const [historyResult, filtersResult] = await Promise.all([
    getIngestionHistory(),
    getIngestionFilters(),
  ]);

  if (!historyResult.success) {
    return <div className="text-destructive">Error: {historyResult.error}</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-medium tracking-tight text-ink">Ingestion</h2>
        <p className="text-muted-foreground">
          Manage filter rules and view the history of all ingested billing
          documents.
        </p>
      </div>
      {filtersResult.success ? (
        <IngestionFiltersSection filters={filtersResult.data} />
      ) : (
        <div className="text-destructive">
          Error loading filters: {filtersResult.error}
        </div>
      )}
      <IngestionHistoryTable data={historyResult.data} />
    </div>
  );
}
