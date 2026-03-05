"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import type { ToolUtilization } from "@/types";

const utilizationConfig = {
  assignedCount: { label: "Assigned", color: "var(--chart-1)" },
  remaining: { label: "Available", color: "var(--chart-5)" },
} satisfies ChartConfig;

interface UtilizationChartProps {
  data: ToolUtilization[];
}

export function UtilizationChart({ data }: UtilizationChartProps) {
  const chartData = data.map((t) => ({
    name: t.toolName,
    assignedCount: t.assignedCount,
    remaining:
      t.maxLicenses !== null
        ? Math.max(0, t.maxLicenses - t.assignedCount)
        : 0,
    maxLicenses: t.maxLicenses,
  }));

  return (
    <ChartContainer config={utilizationConfig} className="min-h-[300px]">
      <BarChart layout="vertical" data={chartData} accessibilityLayer>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 12 }} />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 12 }}
          width={120}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) => {
                if (name === "assignedCount") return `${value} assigned`;
                if (name === "remaining") return `${value} available`;
                return String(value);
              }}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey="assignedCount"
          stackId="a"
          fill="var(--color-assignedCount)"
        />
        <Bar
          dataKey="remaining"
          stackId="a"
          fill="var(--color-remaining)"
          radius={[0, 4, 4, 0]}
        />
      </BarChart>
    </ChartContainer>
  );
}
