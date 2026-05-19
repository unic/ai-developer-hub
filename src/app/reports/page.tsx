import {
  getAssignments,
  getAssignmentSnapshotAt,
} from "@/actions/assignments";
import { getTools } from "@/actions/tools";
import { getUsers } from "@/actions/users";
import {
  getActiveBudget,
  getBilledCostsTimeSeries,
  getBudgetForecast,
} from "@/actions/budget";
import { getBudgetReportData } from "@/actions/reports";
import { AuthGuard } from "@/components/auth-guard";
import { ReportsTabBar } from "./reports-tab-bar";
import { buildCircleReport } from "@/lib/reports/circle-report";
import { getLastMonthEnd } from "@/lib/utils";
import type {
  BudgetReportData,
  ReportOverviewData,
  SparklinePoint,
  ToolSummaryItem,
} from "@/types";

const VALID_TABS = ["overview", "budget"] as const;
type Tab = (typeof VALID_TABS)[number];

function parseTab(raw: string | undefined): Tab {
  if (raw && (VALID_TABS as readonly string[]).includes(raw)) {
    return raw as Tab;
  }
  return "overview";
}

function computeSpendTrend(historicalPeriods: { billedCents: number }[]): {
  spendTrend: ReportOverviewData["spendTrend"];
  spendTrendPct: number;
} {
  const lastTwo = historicalPeriods.slice(-2);
  if (lastTwo.length < 2 || lastTwo[0].billedCents === 0) {
    return { spendTrend: "flat", spendTrendPct: 0 };
  }
  const diff = lastTwo[1].billedCents - lastTwo[0].billedCents;
  const pct = (diff / lastTwo[0].billedCents) * 100;
  if (Math.abs(pct) < 1) return { spendTrend: "flat", spendTrendPct: pct };
  return { spendTrend: diff > 0 ? "up" : "down", spendTrendPct: pct };
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: rawTab } = await searchParams;
  const activeTab = parseTab(rawTab);
  const lastMonthEnd = getLastMonthEnd();

  const [
    assignments,
    tools,
    userList,
    activeBudget,
    priorMonthSnapshot,
    budgetData,
  ] = await Promise.all([
    getAssignments(),
    getTools(),
    getUsers(),
    getActiveBudget(),
    getAssignmentSnapshotAt(lastMonthEnd),
    activeTab === "budget"
      ? getBudgetReportData()
      : Promise.resolve(null as BudgetReportData | null),
  ]);

  const [trendsData, forecastResult] = activeBudget
    ? await Promise.all([
        getBilledCostsTimeSeries(activeBudget.id),
        getBudgetForecast(activeBudget.id),
      ])
    : [[], null];

  const forecastData =
    forecastResult && "success" in forecastResult && forecastResult.success
      ? forecastResult.data
      : null;

  const activeAssignments = assignments.filter((a) => a.status === "active");

  const toolSummary: ToolSummaryItem[] = tools.map((tool) => {
    const toolAssignments = activeAssignments.filter(
      (a) => a.tool.id === tool.id
    );
    const totalCost = toolAssignments.reduce(
      (s, a) => s + a.costAtAssignmentCents,
      0
    );
    return {
      id: tool.id,
      name: tool.name,
      vendor: tool.vendor,
      activeUsers: toolAssignments.length,
      totalMonthlyCost: totalCost,
    };
  });

  const circleReport = buildCircleReport(userList, activeAssignments);

  const totalActiveUsers = userList.filter((u) => u.status === "active").length;
  const totalActiveTools = tools.filter((t) => t.status === "active").length;
  const totalMonthlySpend = activeAssignments.reduce(
    (s, a) => s + a.costAtAssignmentCents,
    0
  );
  const billedYtdCents = trendsData.reduce((s, p) => s + p.billedCents, 0);
  const budgetCeilingCents = activeBudget?.totalAmountCents ?? 0;
  const budgetRemainingCents = budgetCeilingCents - billedYtdCents;
  const utilizationPct =
    budgetCeilingCents > 0 ? (billedYtdCents / budgetCeilingCents) * 100 : 0;

  const historicalPeriods = trendsData.filter((p) => p.billedCents > 0);
  const { spendTrend, spendTrendPct } = computeSpendTrend(historicalPeriods);

  const previousActiveLicenses = priorMonthSnapshot.length;
  const previousExpectedMonthlyCents = priorMonthSnapshot.reduce(
    (s, a) => s + a.costAtAssignmentCents,
    0
  );
  const previousAssignmentsByTool: Record<number, number> = {};
  const previousSpendByTool: Record<number, number> = {};
  for (const a of priorMonthSnapshot) {
    previousAssignmentsByTool[a.toolId] =
      (previousAssignmentsByTool[a.toolId] ?? 0) + 1;
    previousSpendByTool[a.toolId] =
      (previousSpendByTool[a.toolId] ?? 0) + a.costAtAssignmentCents;
  }
  const hasPriorMonthData = priorMonthSnapshot.length > 0;

  const lastCompleted = historicalPeriods.at(-1) ?? null;
  const lastCompletedMonthLabel = lastCompleted?.month ?? null;
  const lastCompletedMonthVariancePct =
    lastCompleted && lastCompleted.plannedCents > 0
      ? ((lastCompleted.billedCents - lastCompleted.plannedCents) /
          lastCompleted.plannedCents) *
        100
      : null;

  const sparkSeries: SparklinePoint[] = trendsData
    .slice(-5)
    .map((p) => ({ label: p.month, value: p.billedCents }))
    .concat({ label: "Now", value: totalMonthlySpend });

  const overviewData: ReportOverviewData = {
    totalActiveUsers,
    totalActiveTools,
    totalActiveLicenses: activeAssignments.length,
    expectedMonthlyCents: totalMonthlySpend,
    billedYtdCents,
    budgetCeilingCents,
    budgetRemainingCents,
    utilizationPct,
    spendTrend,
    spendTrendPct,
    previousMonth: hasPriorMonthData
      ? {
          activeLicenses: previousActiveLicenses,
          expectedMonthlyCents: previousExpectedMonthlyCents,
          assignmentsByTool: previousAssignmentsByTool,
          spendByTool: previousSpendByTool,
        }
      : undefined,
    budgetForecast: forecastData
      ? {
          status: forecastData.status,
          projectedAnnualTotalCents: forecastData.projectedAnnualTotalCents,
          projectedOverageCents:
            forecastData.projectedAnnualTotalCents -
            forecastData.budgetCeilingCents,
        }
      : null,
    lastCompletedMonthLabel,
    lastCompletedMonthVariancePct,
  };

  return (
    <AuthGuard requiredRole="admin">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Reports</h1>
          <p className="text-muted-foreground">
            Tool adoption, license utilization, and spending insights
          </p>
        </div>

        <ReportsTabBar
          activeTab={activeTab}
          overviewData={overviewData}
          toolSummary={toolSummary}
          circleReport={circleReport}
          expectedMonthlySparkline={sparkSeries}
          budgetData={budgetData}
        />
      </div>
    </AuthGuard>
  );
}
