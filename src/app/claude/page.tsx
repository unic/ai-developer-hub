import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { Metadata } from "next";
import {
  getGlobalCostDashboard,
  getAvailableWorkspaceCostMonths,
  getWorkspaceList,
  getOrgConfig,
} from "@/actions/anthropic-global";
import { GlobalMetricsClient } from "@/components/claude/global-metrics-client";
import { WorkspaceBudgetList } from "@/components/claude/workspace-budget-list";
import { OrgCreditsPanel } from "@/components/claude/org-credits-panel";
import { SyncButton } from "@/components/claude/sync-button";
import { db } from "@/lib/db";
import { anthropicSyncStatus } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { format } from "date-fns";
import { Bot } from "lucide-react";

export const metadata: Metadata = { title: "Claude Console" };

export default async function ClaudePage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    redirect("/");
  }

  const currentMonth = format(new Date(), "yyyy-MM");
  const availableMonths = await getAvailableWorkspaceCostMonths();

  // Check for last sync time
  const sentinelRow = await db.query.anthropicSyncStatus.findFirst({
    where: eq(anthropicSyncStatus.userId, -1),
  });
  const lastSyncedAt = sentinelRow?.workspaceSyncCompletedAt ?? null;

  // Empty state if no data yet
  if (availableMonths.length === 0) {
    return <EmptyState />;
  }

  const creditsStatus = { available: false as const, reason: "not_exposed_by_api" as const };
  const [dashboardData, workspaceList, orgConfig] = await Promise.all([
    getGlobalCostDashboard(currentMonth),
    getWorkspaceList(),
    getOrgConfig(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Claude Console</h1>
        <p className="text-muted-foreground">Org-wide Claude API usage and spending</p>
      </div>

      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-muted" />}>
        <GlobalMetricsClient
          initialData={dashboardData}
          availableMonths={availableMonths}
          initialMonth={currentMonth}
          lastSyncedAt={lastSyncedAt}
        />
      </Suspense>

      <section aria-label="Organization billing">
        <h2 className="mb-4 text-lg font-semibold">Organization Billing</h2>
        <OrgCreditsPanel
          orgConfig={orgConfig}
          currentMonthTotalCents={dashboardData.grandTotalCents}
          creditsStatus={creditsStatus}
        />
      </section>

      <section aria-label="Workspace budgets">
        <h2 className="mb-4 text-lg font-semibold">Workspace Budgets</h2>
        <WorkspaceBudgetList workspaces={workspaceList} />
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
