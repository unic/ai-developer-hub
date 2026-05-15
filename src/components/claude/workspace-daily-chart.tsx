"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";

const config: ChartConfig = {
  cost: { label: "Daily spend", color: "var(--chart-1)" },
};

export function WorkspaceDailyChart({
  dailyTotals,
  color,
}: {
  dailyTotals: { date: string; costCents: number }[];
  color?: string | null;
}) {
  if (dailyTotals.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No daily data for this period.
      </p>
    );
  }
  const data = dailyTotals.map((d) => ({
    date: d.date,
    cost: d.costCents / 100,
  }));
  return (
    <ChartContainer config={config} className="h-[260px] w-full">
      <BarChart data={data} accessibilityLayer>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          tickFormatter={(value: string) => {
            const d = new Date(value + "T00:00:00");
            return d.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });
          }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          tickFormatter={(v: number) => `$${v.toFixed(0)}`}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => `$${Number(value).toFixed(2)}`}
            />
          }
        />
        <Bar dataKey="cost" fill={color ?? "var(--chart-1)"} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
