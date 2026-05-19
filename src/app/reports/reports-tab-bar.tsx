"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import type {
  ReportOverviewData,
  ToolSummaryItem,
  CircleReportItem,
  SparklinePoint,
  BudgetReportData,
} from "@/types";

const OverviewPanel = dynamic(
  () =>
    import("@/components/reports/reports-charts-panel").then(
      (m) => m.OverviewPanel
    ),
  {
    ssr: false,
    loading: () => <PanelSkeleton />,
  }
);

const BudgetReport = dynamic(
  () =>
    import("@/components/reports/budget/budget-report").then(
      (m) => m.BudgetReport
    ),
  {
    ssr: false,
    loading: () => <PanelSkeleton />,
  }
);

function PanelSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-2 h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Skeleton className="min-h-[300px] w-full rounded-lg" />
    </div>
  );
}

export interface ReportsTabBarProps {
  activeTab: "overview" | "budget";
  overviewData: ReportOverviewData;
  toolSummary: ToolSummaryItem[];
  circleReport: CircleReportItem[];
  expectedMonthlySparkline: SparklinePoint[];
  budgetData: BudgetReportData | null;
}

export function ReportsTabBar({
  activeTab,
  overviewData,
  toolSummary,
  circleReport,
  expectedMonthlySparkline,
  budgetData,
}: ReportsTabBarProps) {
  const router = useRouter();

  function handleTabChange(value: string) {
    const params = value === "overview" ? "" : `?tab=${value}`;
    router.replace(`/reports${params}`, { scroll: false });
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="budget">Budget</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="mt-6">
        <OverviewPanel
          overviewData={overviewData}
          toolSummary={toolSummary}
          circleReport={circleReport}
          expectedMonthlySparkline={expectedMonthlySparkline}
        />
      </TabsContent>

      <TabsContent value="budget" className="mt-6">
        {budgetData ? (
          <BudgetReport data={budgetData} />
        ) : (
          <PanelSkeleton />
        )}
      </TabsContent>
    </Tabs>
  );
}
