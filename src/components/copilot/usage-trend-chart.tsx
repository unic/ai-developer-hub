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

interface TrendDataPoint {
  date: string;
  suggestions: number;
  acceptances: number;
  activeUsers: number;
  acceptanceRate: number;
}

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
  if (data.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage Trends</CardTitle>
        <CardDescription>
          Daily Copilot suggestions, acceptances, and active users
        </CardDescription>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}
