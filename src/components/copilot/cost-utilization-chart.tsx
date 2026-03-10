"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
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

interface CostUtilizationChartProps {
  data: Array<{
    month: string;
    costPerActiveUserCents: number;
    activeSeats: number;
    totalSeats: number;
  }>;
}

const chartConfig = {
  costPerUser: {
    label: "Cost/Active User ($)",
    color: "var(--chart-1)",
  },
  utilization: {
    label: "Utilization (%)",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

export function CostUtilizationChart({ data }: CostUtilizationChartProps) {
  if (data.length === 0) {
    return null;
  }

  const formatted = data.map((d) => ({
    month: d.month,
    costPerUser: d.costPerActiveUserCents / 100,
    utilization:
      d.totalSeats > 0
        ? Math.round((d.activeSeats / d.totalSeats) * 100)
        : 0,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost vs. Utilization</CardTitle>
        <CardDescription>
          Cost per active user compared to seat utilization rate
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={chartConfig}
          className="min-h-[300px] w-full"
        >
          <LineChart data={formatted} accessibilityLayer>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(v: string) => {
                const d = new Date(v);
                return d.toLocaleDateString("en-US", { month: "short" });
              }}
            />
            <YAxis
              yAxisId="left"
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `$${v}`}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v}%`}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="costPerUser"
              stroke="var(--color-costPerUser)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="utilization"
              stroke="var(--color-utilization)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
