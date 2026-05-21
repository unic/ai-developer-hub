import { WhatChanged } from "@/components/reports/overview/what-changed";
import { getStaticInsights } from "@/lib/reports/insights-static";
import type { ReportOverviewData, SyncStatus, ToolSummaryItem } from "@/types";
import type { WorkspaceAlertSummary } from "@/actions/dashboard";

interface InsightsGridProps {
  overview: ReportOverviewData;
  toolSummary: ToolSummaryItem[];
  workspaceAlert: WorkspaceAlertSummary;
  sync: SyncStatus;
}

export function InsightsGrid({
  overview,
  toolSummary,
  workspaceAlert,
  sync,
}: InsightsGridProps) {
  const previous = overview.previousMonth;

  const currentLicensesByTool = new Map<number, { name: string; count: number }>();
  for (const t of toolSummary) {
    if (t.activeUsers > 0) {
      currentLicensesByTool.set(t.id, { name: t.name, count: t.activeUsers });
    }
  }
  const previousLicensesByTool = new Map<number, { name: string; count: number }>();
  if (previous) {
    for (const t of toolSummary) {
      const count = previous.assignmentsByTool[t.id] ?? 0;
      if (count > 0) {
        previousLicensesByTool.set(t.id, { name: t.name, count });
      }
    }
  }

  const insights = getStaticInsights({
    current: {
      activeLicenses: overview.totalActiveLicenses,
      expectedMonthlyCents: overview.expectedMonthlyCents,
      licensesByTool: currentLicensesByTool,
    },
    previous: previous
      ? {
          activeLicenses: previous.activeLicenses,
          expectedMonthlyCents: previous.expectedMonthlyCents,
          licensesByTool: previousLicensesByTool,
        }
      : null,
    budget: overview.budgetForecast
      ? {
          status: overview.budgetForecast.status,
          projectedAnnualTotalCents:
            overview.budgetForecast.projectedAnnualTotalCents,
          budgetCeilingCents: overview.budgetCeilingCents,
        }
      : null,
    lastMonthVariancePct: overview.lastCompletedMonthVariancePct,
    lastMonthLabel: overview.lastCompletedMonthLabel,
    workspaceAlert: {
      topName: workspaceAlert.topOverWorkspaceName,
      topUtilizationPct: workspaceAlert.topOverWorkspaceUtilizationPct,
      workspacesOverEighty: workspaceAlert.workspacesOverEightyCount,
    },
    sync: {
      lastSyncedAt: sync.lastSyncedAt,
      ageMinutes: sync.ageMinutes,
      isStale: sync.isStale,
    },
  });

  if (insights.length === 0) return null;

  return <WhatChanged insights={insights} />;
}
