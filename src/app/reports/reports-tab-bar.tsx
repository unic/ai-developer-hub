"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import type {
  ReportOverviewData,
  PeriodSpendPoint,
  ToolUtilization,
  BudgetForecast,
  ToolSummaryItem,
  CircleReportItem,
} from "@/types";

const ReportsChartsPanel = dynamic(
  () =>
    import("@/components/reports/reports-charts-panel").then(
      (m) => m.ReportsChartsPanel
    ),
  {
    ssr: false,
    loading: () => (
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
    ),
  }
);

export interface ReportsTabBarProps {
  activeTab: "overview" | "trends" | "usage" | "forecast";
  overviewData: ReportOverviewData;
  trendsData: PeriodSpendPoint[];
  usageData: ToolUtilization[];
  forecastData: BudgetForecast | null;
  toolSummary: ToolSummaryItem[];
  circleReport: CircleReportItem[];
}

export function ReportsTabBar({
  activeTab,
  overviewData,
  trendsData,
  usageData,
  forecastData,
  toolSummary,
  circleReport,
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
        <TabsTrigger value="trends">Trends</TabsTrigger>
        <TabsTrigger value="usage">Usage</TabsTrigger>
        <TabsTrigger value="forecast">Forecast</TabsTrigger>
      </TabsList>

      <TabsContent value={activeTab} className="mt-6">
        <ReportsChartsPanel
          activeTab={activeTab}
          overviewData={overviewData}
          trendsData={trendsData}
          usageData={usageData}
          forecastData={forecastData}
          toolSummary={toolSummary}
          circleReport={circleReport}
        />
      </TabsContent>
    </Tabs>
  );
}
