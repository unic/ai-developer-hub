"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LineChart as LineChartIcon } from "lucide-react";
import { isUsageTrendSparse } from "@/lib/copilot-chart-utils";
import type { TrendDataPoint } from "@/lib/copilot-chart-utils";

interface UsageTrendChartProps {
  data: TrendDataPoint[];
}

const chartConfig = {
  suggestions: {
    label: "Suggestions",
    color: "var(--chart-1)",
  },
  acceptances: {
    label: "Acceptances",
    color: "var(--chart-2)",
  },
  activeUsers: {
    label: "Active Users",
    color: "var(--chart-3)",
  },
} satisfies ChartConfig;

export function UsageTrendChart({ data }: UsageTrendChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage Trends</CardTitle>
        <CardDescription>
          Daily Copilot suggestions, acceptances, and active users
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isUsageTrendSparse(data) ? (
          <div className="flex flex-col items-center justify-center min-h-[300px] gap-3 text-muted-foreground">
            <LineChartIcon
              className="size-10"
              aria-hidden="true"
              focusable="false"
            />
            <p className="text-sm text-center max-w-xs">
              Not enough usage data yet — Copilot trends will appear here once
              at least 2 days with recorded Copilot usage have been synced.
            </p>
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="min-h-[300px] w-full">
            <LineChart data={data} accessibilityLayer>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value: string) => {
                  const date = new Date(value);
                  return date.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  });
                }}
              />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Line
                type="monotone"
                dataKey="suggestions"
                stroke="var(--color-suggestions)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="acceptances"
                stroke="var(--color-acceptances)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="activeUsers"
                stroke="var(--color-activeUsers)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
