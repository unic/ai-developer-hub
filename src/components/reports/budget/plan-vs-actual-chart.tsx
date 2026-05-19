"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatCurrency } from "@/lib/utils";
import type { BudgetForecast, PeriodWithActual } from "@/types";

interface PlanVsActualChartProps {
  periods: PeriodWithActual[];
  forecast: BudgetForecast;
}

const chartConfig: ChartConfig = {
  planned: { label: "Planned", color: "var(--chart-3)" },
  billed: { label: "Billed", color: "var(--chart-1)" },
  running: { label: "API (running)", color: "var(--chart-2)" },
  forecast: { label: "Forecast", color: "var(--chart-4)" },
};

export function PlanVsActualChart({ periods, forecast }: PlanVsActualChartProps) {
  const today = new Date();
  const projectionsByMonth = new Map(
    forecast.projections.map((p) => [p.month, p.projectedAmountCents])
  );
  // `getBudgetForecast` only projects ~6 months. Use the average to fill the
  // remainder so every future month has a forecast bar.
  const avgProjectedMonthly =
    forecast.projections.length > 0
      ? forecast.projections.reduce(
          (s, p) => s + p.projectedAmountCents,
          0
        ) / forecast.projections.length
      : 0;

  const data = periods.map((p) => {
    const isPast = new Date(p.endDate) < today;
    const isCurrent =
      new Date(p.startDate) <= today && new Date(p.endDate) >= today;
    return {
      month: shortMonth(p.periodLabel),
      planned: p.plannedAmountCents,
      // Past + current: show actual (billed + running). Future: empty.
      billed: isPast || isCurrent ? p.billedTotalCents : 0,
      running: isPast || isCurrent ? p.runningCostCents : 0,
      forecast:
        !isPast && !isCurrent
          ? projectionsByMonth.get(p.periodLabel) ?? avgProjectedMonthly
          : 0,
    };
  });

  const plannedAvg =
    periods.length > 0
      ? periods.reduce((s, p) => s + p.plannedAmountCents, 0) / periods.length
      : 0;

  return (
    <ChartContainer config={chartConfig} className="h-[340px] w-full">
      <BarChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis
          tickFormatter={(v) => `$${(Number(v) / 100_000).toFixed(0)}k`}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        {plannedAvg > 0 && (
          <ReferenceLine
            y={plannedAvg}
            stroke="var(--chart-3)"
            strokeDasharray="6 4"
            strokeOpacity={0.5}
          />
        )}
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.2 }}
          content={
            <ChartTooltipContent
              labelKey="month"
              formatter={(value, name) => {
                const cents = Number(value);
                if (cents === 0) return null;
                const label =
                  name === "planned"
                    ? "Planned"
                    : name === "billed"
                      ? "Billed"
                      : name === "running"
                        ? "API (running)"
                        : "Forecast";
                return (
                  <div className="flex w-full items-center justify-between gap-4">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-mono">{formatCurrency(cents)}</span>
                  </div>
                );
              }}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="planned" fill="var(--color-planned)" radius={[4, 4, 0, 0]} />
        <Bar
          dataKey="billed"
          stackId="actual"
          fill="var(--color-billed)"
          radius={[0, 0, 0, 0]}
        >
          {data.map((d, i) => (
            <Cell
              key={`billed-${i}`}
              fill={
                d.billed + d.running > d.planned && d.planned > 0
                  ? "var(--destructive)"
                  : "var(--color-billed)"
              }
            />
          ))}
        </Bar>
        <Bar
          dataKey="running"
          stackId="actual"
          fill="var(--color-running)"
          radius={[4, 4, 0, 0]}
          fillOpacity={0.8}
        />
        <Bar
          dataKey="forecast"
          fill="var(--color-forecast)"
          fillOpacity={0.45}
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ChartContainer>
  );
}

function shortMonth(label: string): string {
  // "Apr 2026" → "Apr" / "Q1 2026" → "Q1"
  return label.split(" ")[0];
}
