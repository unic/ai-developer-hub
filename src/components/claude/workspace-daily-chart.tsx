"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import { formatCurrency, formatUtcDateOnly } from "@/lib/utils";
import { formatCurrencyFromDollars, formatDateLong } from "@/lib/chart-format";

const config: ChartConfig = {
  cost: { label: "Daily spend", color: "var(--chart-1)" },
  estimated: { label: "Today (est.)", color: "var(--chart-1)" },
};

export function WorkspaceDailyChart({
  dailyTotals,
  color,
  limitCents,
  daysInMonth,
  estimatedTodayCents,
}: {
  dailyTotals: { date: string; costCents: number }[];
  color?: string | null;
  /** Monthly limit in cents — drives the per-day prorated cap reference line. */
  limitCents?: number | null;
  /** Days in the selected month, used to prorate the monthly limit. */
  daysInMonth?: number;
  /** Spec 033 — appends a ghost/dashed "today (est.)" bar when present. */
  estimatedTodayCents?: number | null;
}) {
  if (dailyTotals.length === 0 && !estimatedTodayCents) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No daily data for this period.
      </p>
    );
  }
  const data: { date: string; cost: number | null; estimated: number | null }[] =
    dailyTotals.map((d) => ({
      date: d.date,
      cost: d.costCents / 100,
      estimated: null,
    }));
  if (estimatedTodayCents != null && estimatedTodayCents > 0) {
    const today = formatUtcDateOnly(new Date());
    // Replace today's slot if cost_report somehow already has it; else append.
    const existing = data.find((d) => d.date === today);
    if (existing) existing.estimated = estimatedTodayCents / 100;
    else data.push({ date: today, cost: null, estimated: estimatedTodayCents / 100 });
  }

  const dailyCapDollars =
    limitCents != null && daysInMonth && daysInMonth > 0
      ? limitCents / 100 / daysInMonth
      : null;

  // Sub-dollar values lose precision under `toFixed(0)` — when the chart's
  // max is below ~$5, switch to 2 decimals so ticks read e.g. "$0.50" not
  // four duplicate "$1" labels.
  const maxValue = data.reduce(
    (acc, d) => Math.max(acc, d.cost ?? 0, d.estimated ?? 0),
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
              numberFormat="currency"
              labelFormatter={(label) => formatDateLong(String(label))}
              footer={
                dailyCapDollars != null
                  ? {
                      label: "Daily cap",
                      value: formatCurrencyFromDollars(dailyCapDollars),
                    }
                  : undefined
              }
            />
          }
        />
        <Bar
          dataKey="cost"
          fill={color ?? "var(--chart-1)"}
          radius={[4, 4, 0, 0]}
          maxBarSize={56}
        />
        {data.some((d) => d.estimated != null) && (
          <Bar
            dataKey="estimated"
            name="Today (est.)"
            fill="var(--chart-1)"
            fillOpacity={0.28}
            stroke="var(--chart-1)"
            strokeOpacity={0.6}
            strokeDasharray="3 3"
            radius={[4, 4, 0, 0]}
            maxBarSize={56}
          />
        )}
      </BarChart>
    </ChartContainer>
  );
}
