"use client";

import { useState, useTransition, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MonthPicker } from "@/components/profile/month-picker";
import { getGlobalCostDashboard } from "@/actions/anthropic-global";
import { formatDistanceToNow } from "date-fns";
import type { GlobalCostDashboardData } from "@/types";
import { formatCurrency } from "@/lib/utils";

type GlobalMetricsClientProps = {
  initialData: GlobalCostDashboardData;
  availableMonths: string[];
  initialMonth: string;
  lastSyncedAt: Date | null;
};

const ALL_WORKSPACES = "__all__";

const chartConfig = {
  cost: { label: "Cost (USD)", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function GlobalMetricsClient({
  initialData,
  availableMonths,
  initialMonth,
  lastSyncedAt,
}: GlobalMetricsClientProps) {
  const [dashboardData, setDashboardData] = useState<GlobalCostDashboardData>(initialData);
  const [selectedMonth, setSelectedMonth] = useState<string>(initialMonth);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>(ALL_WORKSPACES);
  const [isPending, startTransition] = useTransition();

  function handleMonthChange(newMonth: string) {
    setSelectedMonth(newMonth);
    setSelectedWorkspace(ALL_WORKSPACES);
    startTransition(async () => {
      const data = await getGlobalCostDashboard(newMonth);
      setDashboardData(data);
    });
  }

  const { displayDailyTotals, displayTotal } = useMemo(() => {
    if (selectedWorkspace === ALL_WORKSPACES) {
      return {
        displayDailyTotals: dashboardData.dailyTotals,
        displayTotal: dashboardData.grandTotalCents,
      };
    }
    const ws = dashboardData.workspaceBreakdown.find(
      (w) => (w.workspaceId ?? "__null__") === selectedWorkspace
    );
    return {
      displayDailyTotals: ws?.dailyTotals ?? [],
      displayTotal: ws?.totalCents ?? 0,
    };
  }, [dashboardData, selectedWorkspace]);

  const chartData = useMemo(
    () =>
      displayDailyTotals.map((d) => ({
        date: d.date,
        cost: d.costCents / 100,
      })),
    [displayDailyTotals]
  );

  return (
    <div className="space-y-4">
      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3">
        <MonthPicker
          value={selectedMonth}
          onChange={handleMonthChange}
          months={availableMonths}
        />
        <Select value={selectedWorkspace} onValueChange={setSelectedWorkspace}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="All workspaces" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_WORKSPACES}>All workspaces</SelectItem>
            {dashboardData.workspaceBreakdown.map((ws) => (
              <SelectItem
                key={ws.workspaceId ?? "__null__"}
                value={ws.workspaceId ?? "__null__"}
              >
                {ws.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {lastSyncedAt && (
          <p className="text-sm text-muted-foreground">
            Last synced {formatDistanceToNow(lastSyncedAt, { addSuffix: true })}
          </p>
        )}
      </div>

      {/* Summary card */}
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>
            {selectedWorkspace === ALL_WORKSPACES ? "Total org spend" : "Workspace spend"} —{" "}
            {selectedMonth}
          </CardDescription>
          <CardTitle className="text-3xl tabular-nums">
            {isPending ? (
              <span className="animate-pulse text-muted-foreground">Loading…</span>
            ) : (
              formatCurrency(displayTotal)
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No data for this period.
            </p>
          ) : (
            <ChartContainer config={chartConfig} className="min-h-[300px] w-full">
              <BarChart data={chartData} accessibilityLayer>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value: string) => {
                    const date = new Date(value + "T00:00:00");
                    return date.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    });
                  }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value: number) => `$${value.toFixed(0)}`}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => `$${Number(value).toFixed(2)}`}
                    />
                  }
                />
                <Bar
                  dataKey="cost"
                  fill="var(--chart-1)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
