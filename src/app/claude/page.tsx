import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { Metadata } from "next";
import {
  getAvailableWorkspaceCostMonths,
  getWorkspaceList,
  getOrgConfig,
  getDashboardKpis,
  getDailyTotalsByWorkspace,
  getSyncStatus,
  getTwelveMonthTotals,
  getCumulativePacing,
  getTopMovers,
  getWorkspaceSparklines,
} from "@/actions/anthropic-global";
import { GlobalMetricsClient } from "@/components/claude/global-metrics-client";
import { WorkspaceBudgetList } from "@/components/claude/workspace-budget-list";
import { OrgBillingBudgetCard } from "@/components/claude/org-credits-panel";
import { HistoricalTrendCard } from "@/components/claude/historical-trend-card";
import { SyncButton } from "@/components/claude/sync-button";
import { ClaudeTabs } from "@/components/claude/claude-tabs";
import { getCurrentMonth, getUtcDaysInMonth } from "@/lib/utils";
import { LoadingState } from "@/components/ui/loading-state";
import { Bot } from "lucide-react";

export const metadata: Metadata = { title: "Claude API Spending" };

export default async function ClaudePage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    redirect("/");
  }

  const now = new Date();
  // UTC throughout — the cost tables key on UTC calendar dates, and the today
  // estimate / projection denominator count the UTC day (spec 033).
  const currentMonth = getCurrentMonth();
  const todayDayOfMonth = now.getUTCDate();
  const daysInMonth = getUtcDaysInMonth(now);
  const availableMonths = await getAvailableWorkspaceCostMonths();

  if (availableMonths.length === 0) {
    return <EmptyState />;
  }

  const [
    kpis,
    daily,
    workspaceList,
    orgConfig,
    syncStatus,
    twelveMonth,
    pacing,
    movers,
    sparklines,
  ] = await Promise.all([
    getDashboardKpis(currentMonth),
    getDailyTotalsByWorkspace(currentMonth),
    getWorkspaceList(),
    getOrgConfig(),
    getSyncStatus(),
    getTwelveMonthTotals(),
    getCumulativePacing(),
    getTopMovers(),
    getWorkspaceSparklines(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Claude API Spending</h1>
          <p className="text-muted-foreground">
            Org-wide usage, budgets, and Anthropic sync status.
          </p>
        </div>
        <SyncButton />
      </div>

      <ClaudeTabs />

      <Suspense fallback={<LoadingState label="LOADING" />}>
        <GlobalMetricsClient
          initialKpis={kpis}
          initialDaily={daily}
          availableMonths={availableMonths}
          initialMonth={currentMonth}
          orgBudgetCents={orgConfig?.billingBudgetLimitCents ?? null}
          syncStatus={syncStatus}
          workspaceOptions={workspaceList.map((w) => ({
            key: w.workspaceId ?? "__default__",
            name: w.name,
          }))}
        />
      </Suspense>

      <HistoricalTrendCard
        twelveMonth={twelveMonth}
        pacing={pacing}
        movers={movers}
        currentMonth={currentMonth}
        projectedMonthEndCents={kpis.projectedMonthEndCents}
        budgetLimitCents={orgConfig?.billingBudgetLimitCents ?? null}
        todayDayOfMonth={todayDayOfMonth}
        daysInMonth={daysInMonth}
        todayEstimateCents={kpis.todayEstimate?.cents ?? null}
      />

      <section aria-label="Organization billing">
        <h2 className="mb-4 text-lg font-semibold">Organization Billing</h2>
        <OrgBillingBudgetCard
          orgConfig={orgConfig}
          currentMonthTotalCents={kpis.totalCents}
          projectedMonthEndCents={kpis.projectedMonthEndCents}
          todayEstimate={kpis.todayEstimate}
        />
      </section>

      <section aria-label="Workspace budgets">
        <h2 className="mb-4 text-lg font-semibold">Workspace Budgets</h2>
        <WorkspaceBudgetList
          workspaces={workspaceList}
          sparklines={sparklines}
        />
      </section>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <Bot className="mb-4 size-12 text-muted-foreground" />
      <h2 className="mb-2 text-xl font-semibold">No data yet</h2>
      <p className="mb-6 max-w-sm text-center text-muted-foreground">
        Workspace cost data will appear after the first sync. You can trigger a
        sync manually.
      </p>
      <SyncButton />
    </div>
  );
}
