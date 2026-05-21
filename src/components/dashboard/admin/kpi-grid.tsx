import { KpiWithMom } from "@/components/reports/overview/kpi-with-mom";
import { buildDelta, buildPctDelta } from "@/lib/format-delta";
import { formatCurrency } from "@/lib/utils";
import type { ReportOverviewData } from "@/types";

interface KpiGridProps {
  overview: ReportOverviewData;
  copilot: {
    acceptanceRate: number | null;
    totalActiveUsers: number;
    trend: number[];
  } | null;
  toolCount: number;
}

export function KpiGrid({ overview, copilot, toolCount }: KpiGridProps) {
  const previous = overview.previousMonth;
  const prevExpected = previous?.expectedMonthlyCents ?? 0;
  const expectedHasPrior = previous != null && prevExpected > 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiWithMom
        label="Active users"
        value={overview.totalActiveUsers.toLocaleString()}
      />
      <KpiWithMom
        label="Active tools"
        value={toolCount.toLocaleString()}
      />
      <KpiWithMom
        label="Active licenses"
        value={overview.totalActiveLicenses.toLocaleString()}
        delta={
          previous
            ? buildDelta(overview.totalActiveLicenses - previous.activeLicenses)
            : undefined
        }
        comparison={
          previous
            ? `vs ${previous.activeLicenses.toLocaleString()} last month`
            : undefined
        }
      />
      <KpiWithMom
        label="Expected monthly"
        value={formatCurrency(overview.expectedMonthlyCents)}
        delta={
          expectedHasPrior
            ? buildPctDelta(
                overview.expectedMonthlyCents - prevExpected,
                prevExpected
              )
            : undefined
        }
        comparison={
          expectedHasPrior
            ? `vs ${formatCurrency(prevExpected)} last month`
            : undefined
        }
        note={
          copilot
            ? `Copilot acceptance ${
                copilot.acceptanceRate === null
                  ? "—"
                  : `${copilot.acceptanceRate}%`
              }${copilot.totalActiveUsers > 0 ? ` · ${copilot.totalActiveUsers} devs` : ""}`
            : "Licenses only — API usage tracked separately"
        }
      />
    </div>
  );
}
