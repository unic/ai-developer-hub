import { getAdminDashboardData } from "@/actions/dashboard";
import { BudgetHeroSection } from "./budget-hero-section";
import { ThisMonthCard } from "./this-month-card";
import { KpiGrid } from "./kpi-grid";
import { SpendTrendCard } from "./spend-trend-card";
import { InsightsGrid } from "./insights-grid";
import { ActivityTimeline } from "./activity-timeline";
import { JumpToRow } from "./jump-to-row";
import { Card, CardContent } from "@/components/ui/card";
import { ViewAsToggle } from "@/components/dashboard/view-as-toggle";
import { formatDistanceToNow } from "date-fns";

export async function AdminDashboard() {
  const data = await getAdminDashboardData();

  if (!data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Unable to load dashboard data.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Overview
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight lg:text-3xl">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AI spend, licenses, and adoption — month-to-date and YTD context.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ViewAsToggle mode="to-viewer" />
          <SyncChip
            lastSyncedAt={data.sync.lastSyncedAt}
            isStale={data.sync.isStale}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <BudgetHeroSection
            overview={data.overview}
            spendSeries={data.spendSeries}
            budgetCeilingCents={data.budgetCeilingCents}
            budgetOriginalCeilingCents={data.budgetOriginalCeilingCents}
            billedYtdCents={data.billedYtdCents}
          />
        </div>
        <ThisMonthCard snapshot={data.thisMonth} />
      </div>

      <KpiGrid
        overview={data.overview}
        copilot={data.copilot}
        toolCount={data.overview.totalActiveTools}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <SpendTrendCard
            spendSeries={data.spendSeries}
            billedYtdCents={data.billedYtdCents}
          />
          <InsightsGrid
            overview={data.overview}
            toolSummary={data.toolSummary}
            workspaceAlert={data.workspaceAlert}
            sync={data.sync}
          />
        </div>
        <ActivityTimeline activity={data.activity} />
      </div>

      <JumpToRow
        toolCount={data.overview.totalActiveTools}
        userCount={data.overview.totalActiveUsers}
        licenseCount={data.overview.totalActiveLicenses}
        budgetStatus={data.overview.budgetForecast?.status ?? null}
        budgetUtilizationPct={data.overview.utilizationPct}
      />
    </div>
  );
}

function SyncChip({
  lastSyncedAt,
  isStale,
}: {
  lastSyncedAt: Date | null;
  isStale: boolean;
}) {
  if (!lastSyncedAt) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border bg-card/60 px-3 py-1 text-[11px] text-muted-foreground">
        <span className="size-2 rounded-full bg-muted-foreground" />
        Sync status unavailable
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border bg-card/60 px-3 py-1 text-[11px] ${
        isStale ? "text-yellow-500 dark:text-yellow-400" : "text-muted-foreground"
      }`}
    >
      <span
        className={`size-2 rounded-full ${
          isStale ? "bg-yellow-500" : "bg-green-500 dark:bg-green-400"
        }`}
      />
      {isStale ? "Sync data is stale" : "All sources synced"} ·{" "}
      {formatDistanceToNow(lastSyncedAt, { addSuffix: true })}
    </span>
  );
}
