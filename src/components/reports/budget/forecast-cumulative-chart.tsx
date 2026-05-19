"use client";

import {
  CartesianGrid,
  ComposedChart,
  Line,
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

interface ForecastCumulativeChartProps {
  periods: PeriodWithActual[];
  forecast: BudgetForecast;
}

const chartConfig: ChartConfig = {
  actual: { label: "Actual cumulative", color: "var(--chart-1)" },
  forecast: { label: "Forecast cumulative", color: "var(--chart-2)" },
};

export function ForecastCumulativeChart({
  periods,
  forecast,
}: ForecastCumulativeChartProps) {
  const today = new Date();
  const projection = buildProjectionLookup(forecast);

  let runningActual = 0;
  let runningForecast = 0;
  const data = periods.map((p) => {
    const phase = classifyPeriod(p, today);
    if (phase === "future") {
      runningForecast += projection.for(p.periodLabel);
      return { month: shortMonth(p.periodLabel), actual: null, forecast: runningForecast };
    }
    runningActual += p.actualCents;
    runningForecast = runningActual;
    return {
      month: shortMonth(p.periodLabel),
      actual: runningActual,
      forecast: phase === "current" ? runningForecast : null,
    };
  });

  return (
    <ChartContainer config={chartConfig} className="h-[300px] w-full">
      <ComposedChart data={data} margin={{ top: 16, right: 24, left: 0, bottom: 0 }}>
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
        <ReferenceLine
          y={forecast.budgetCeilingCents}
          stroke="var(--chart-3)"
          strokeDasharray="6 4"
          label={{
            value: `Ceiling ${formatCurrency(forecast.budgetCeilingCents)}`,
            position: "insideTopRight",
            fontSize: 11,
            fill: "var(--muted-foreground)",
          }}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelKey="month"
              formatter={(value, name) => {
                if (value === null) return null;
                return (
                  <div className="flex w-full items-center justify-between gap-4">
                    <span className="text-muted-foreground">
                      {name === "actual" ? "Actual" : "Forecast"}
                    </span>
                    <span className="font-mono">
                      {formatCurrency(Number(value))}
                    </span>
                  </div>
                );
              }}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Line
          type="monotone"
          dataKey="actual"
          stroke="var(--color-actual)"
          strokeWidth={2.5}
          dot={{ r: 3 }}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="forecast"
          stroke="var(--color-forecast)"
          strokeWidth={2}
          strokeDasharray="6 4"
          dot={false}
          connectNulls
          isAnimationActive={false}
        />
      </ComposedChart>
    </ChartContainer>
  );
}
