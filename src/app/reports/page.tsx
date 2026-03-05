import { getAssignments } from "@/actions/assignments";
import { getTools } from "@/actions/tools";
import { getUsers } from "@/actions/users";
import {
  getActiveBudget,
  getBilledCostsTimeSeries,
  getBudgetForecast,
} from "@/actions/budget";
import { getLicenseUtilizationByTool } from "@/actions/assignments";
import { AuthGuard } from "@/components/auth-guard";
import { ReportsTabBar } from "./reports-tab-bar";
import type {
  ReportOverviewData,
  ToolSummaryItem,
  CircleReportItem,
} from "@/types";

const VALID_TABS = ["overview", "trends", "usage", "forecast"] as const;
type Tab = (typeof VALID_TABS)[number];

function parseTab(raw: string | undefined): Tab {
  if (raw && (VALID_TABS as readonly string[]).includes(raw)) {
    return raw as Tab;
  }
  return "overview";
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: rawTab } = await searchParams;
  const activeTab = parseTab(rawTab);

  const [assignments, tools, userList, activeBudget] = await Promise.all([
    getAssignments(),
    getTools(),
    getUsers(),
    getActiveBudget(),
  ]);

  const [trendsData, usageData, forecastResult] = await Promise.all([
    activeBudget ? getBilledCostsTimeSeries(activeBudget.id) : Promise.resolve([]),
    getLicenseUtilizationByTool(),
    activeBudget ? getBudgetForecast(activeBudget.id) : Promise.resolve(null),
  ]);

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

  const circles = [...new Set(userList.map((u) => u.circle))];
  const circleReport: CircleReportItem[] = circles.map((circle) => {
    const circleUsers = userList.filter((u) => u.circle === circle);
    const circleUserIds = new Set(circleUsers.map((u) => u.id));
    const circleAssignments = activeAssignments.filter((a) =>
      circleUserIds.has(a.user.id)
    );
    const totalCost = circleAssignments.reduce(
      (s, a) => s + a.costAtAssignmentCents,
      0
    );
    return {
      circle,
      userCount: circleUsers.length,
      licenseCount: circleAssignments.length,
      totalMonthlyCost: totalCost,
    };
  });

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
    budgetCeilingCents > 0
      ? (billedYtdCents / budgetCeilingCents) * 100
      : 0;

  // Compute spend trend from last two periods with actual spend
  const historicalPeriods = trendsData.filter((p) => p.billedCents > 0);
  const lastTwo = historicalPeriods.slice(-2);
  let spendTrend: "up" | "down" | "flat" = "flat";
  let spendTrendPct = 0;
  if (lastTwo.length === 2 && lastTwo[0].billedCents > 0) {
    const diff = lastTwo[1].billedCents - lastTwo[0].billedCents;
    spendTrendPct = (diff / lastTwo[0].billedCents) * 100;
    spendTrend =
      Math.abs(spendTrendPct) < 1
        ? "flat"
        : diff > 0
          ? "up"
          : "down";
  }

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
          trendsData={trendsData}
          usageData={usageData}
          forecastData={forecastData}
          toolSummary={toolSummary}
          circleReport={circleReport}
        />
      </div>
    </AuthGuard>
  );
}
