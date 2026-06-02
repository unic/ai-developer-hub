"use client";

import type { ComponentProps } from "react";
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
import {
  buildProjectionLookup,
  classifyPeriod,
  shortMonth,
} from "@/lib/reports/period-helpers";
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

// "Billed" segments turn red (var(--destructive)) on any month where actual
// spend exceeds the plan — that's a conditional alert state on the Billed
// series, not a series of its own. Recharts colors each legend entry from its
// <Bar>'s fill and ignores per-<Cell> overrides, so the red would otherwise
// never appear in the legend. Append an explicit "Over budget" swatch (only
// when a breach exists) so the red bars are accounted for.
function PlanVsActualLegend({
  showOverBudget,
  ...props
}: ComponentProps<typeof ChartLegendContent> & { showOverBudget: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-3">
      <ChartLegendContent {...props} className="!p-0" />
      {showOverBudget && (
        <div className="flex items-center gap-1.5">
          <div
            className="h-2 w-2 shrink-0 rounded-[2px]"
            style={{ backgroundColor: "var(--destructive)" }}
          />
          Over budget
        </div>
      )}
    </div>
  );
}

export function PlanVsActualChart({
  periods,
  forecast,
}: PlanVsActualChartProps) {
  const today = new Date();
  const projection = buildProjectionLookup(forecast);

  const data = periods.map((p) => {
    const phase = classifyPeriod(p, today);
    const showActual = phase !== "future";
    return {
      month: shortMonth(p.periodLabel),
      planned: p.plannedAmountCents,
      billed: showActual ? p.billedTotalCents : 0,
      running: showActual ? p.runningCostCents : 0,
      forecast: phase === "future" ? projection.for(p.periodLabel) : 0,
    };
  });

  const plannedAvg =
    periods.length > 0
      ? periods.reduce((s, p) => s + p.plannedAmountCents, 0) / periods.length
      : 0;

  // Mirror the per-Cell red condition below so the legend only explains the
  // alert color when at least one month actually breaches its plan.
  const anyOverBudget = data.some(
    (d) => d.planned > 0 && d.billed + d.running > d.planned,
  );

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
                  chartConfig[name as keyof typeof chartConfig]?.label ??
                  String(name);
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
        <ChartLegend
          content={<PlanVsActualLegend showOverBudget={anyOverBudget} />}
        />
        <Bar
          dataKey="planned"
          fill="var(--color-planned)"
          radius={[4, 4, 0, 0]}
        />
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
