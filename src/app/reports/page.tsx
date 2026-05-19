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
import { OverviewPanel } from "@/components/reports/reports-charts-panel";
import { buildCircleReport } from "@/lib/reports/circle-report";
import { classifyPeriod } from "@/lib/reports/period-helpers";
import { getLastMonthEnd } from "@/lib/utils";
import type {
  ReportOverviewData,
  SparklinePoint,
  ToolSummaryItem,
} from "@/types";

export default async function ReportsOverviewPage() {
  const lastMonthEnd = getLastMonthEnd();

  const [assignments, tools, userList, activeBudget, priorMonthSnapshot] =
    await Promise.all([
      getAssignments(),
      getTools(),
      getUsers(),
      getActiveBudget(),
      getAssignmentSnapshotAt(lastMonthEnd),
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

  // Only fully-past periods qualify as "completed" — the current month's
  // billing is partial and comparing it to a full-month plan is misleading.
  const today = new Date();
  const completedTrend = (activeBudget?.periods ?? [])
    .filter((bp) => classifyPeriod(bp, today) === "past")
    .map((bp) => {
      const trend = trendsData.find((t) => t.month === bp.periodLabel);
      return {
        label: bp.periodLabel,
        billedCents: trend?.billedCents ?? 0,
        plannedCents: trend?.plannedCents ?? 0,
      };
    })
    .filter((p) => p.billedCents > 0);
  const { spendTrend, spendTrendPct } = computeSpendTrend(completedTrend);

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

  const lastCompleted = completedTrend.at(-1) ?? null;
  const lastCompletedMonthLabel = lastCompleted?.label ?? null;
  const lastCompletedMonthVariancePct =
    lastCompleted && lastCompleted.plannedCents > 0
      ? ((lastCompleted.billedCents - lastCompleted.plannedCents) /
          lastCompleted.plannedCents) *
        100
      : null;

  const sparkSeries: SparklinePoint[] = trendsData
    .slice(-5)
    .map((p) => ({ label: p.month, value: p.expectedCents }))
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
    <OverviewPanel
      overviewData={overviewData}
      toolSummary={toolSummary}
      circleReport={circleReport}
      expectedMonthlySparkline={sparkSeries}
    />
  );
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
