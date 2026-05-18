"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import type { UserDailyRow } from "@/types";

const config: ChartConfig = {
  cost: { label: "Daily spend", color: "var(--chart-1)" },
};

/**
 * Per-user daily-spend chart. Mirrors `WorkspaceDailyChart`'s polish:
 *
 * - `maxBarSize={56}` so individual days never balloon into giant bars when
 *   the month is sparse.
 * - Sub-dollar Y-axis formatter when the daily max is below $5, so a max of
 *   $0.50 produces "$0.50" ticks instead of four identical "$1" labels.
 * - No per-day reference line — per-user budget caps don't exist (spec 027
 *   explicitly defers per-user limits).
 */
export function UserDailyChart({
  dailyTotals,
  color,
}: {
  dailyTotals: UserDailyRow[];
  color?: string | null;
}) {
  const positives = dailyTotals.filter((d) => d.costCents > 0);
  if (positives.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No daily usage for this period.
      </p>
    );
  }

  const data = dailyTotals.map((d) => ({
    date: d.date,
    cost: d.costCents / 100,
  }));

  const maxValue = data.reduce((acc, d) => Math.max(acc, d.cost), 0);
  const useFineTicks = maxValue < 5;
  const fmtAxis = (v: number) =>
    useFineTicks ? `$${v.toFixed(2)}` : `$${v.toFixed(0)}`;

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
          tickFormatter={fmtAxis}
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
          fill={color ?? "var(--chart-1)"}
          radius={[4, 4, 0, 0]}
          maxBarSize={56}
        />
      </BarChart>
    </ChartContainer>
  );
}
