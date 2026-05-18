"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import { formatCurrency } from "@/lib/utils";

const config: ChartConfig = {
  cost: { label: "Daily spend", color: "var(--chart-1)" },
};

export function WorkspaceDailyChart({
  dailyTotals,
  color,
  limitCents,
  daysInMonth,
}: {
  dailyTotals: { date: string; costCents: number }[];
  color?: string | null;
  /** Monthly limit in cents — drives the per-day prorated cap reference line. */
  limitCents?: number | null;
  /** Days in the selected month, used to prorate the monthly limit. */
  daysInMonth?: number;
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

  const dailyCapDollars =
    limitCents != null && daysInMonth && daysInMonth > 0
      ? limitCents / 100 / daysInMonth
      : null;

  // Sub-dollar values lose precision under `toFixed(0)` — when the chart's
  // max is below ~$5, switch to 2 decimals so ticks read e.g. "$0.50" not
  // four duplicate "$1" labels.
  const maxValue = data.reduce(
    (acc, d) => Math.max(acc, d.cost),
    dailyCapDollars ?? 0
  );
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
        {dailyCapDollars != null && (
          <ReferenceLine
            y={dailyCapDollars}
            stroke="var(--destructive)"
            strokeDasharray="3 3"
            label={{
              value: `Daily cap ${formatCurrency(Math.round(dailyCapDollars * 100))}`,
              position: "insideTopRight",
              fill: "var(--destructive)",
              fontSize: 10,
            }}
          />
        )}
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
