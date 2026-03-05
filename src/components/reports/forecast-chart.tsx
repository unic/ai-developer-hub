"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import type { ForecastChartPoint } from "@/types";

const forecastConfig = {
  historical: { label: "Actual", color: "var(--chart-1)" },
  projected: { label: "Projected", color: "var(--chart-2)" },
} satisfies ChartConfig;

interface ForecastChartProps {
  data: ForecastChartPoint[];
  budgetCeilingCents: number;
}

export function ForecastChart({ data, budgetCeilingCents }: ForecastChartProps) {
  return (
    <ChartContainer config={forecastConfig} className="min-h-[300px]">
      <LineChart data={data} accessibilityLayer>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
        <YAxis
          tickFormatter={(v: number) => `$${(v / 100).toFixed(0)}`}
          tick={{ fontSize: 12 }}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) =>
                `$${((value as number) / 100).toFixed(2)}`
              }
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <ReferenceLine
          y={budgetCeilingCents}
          stroke="var(--chart-5)"
          strokeDasharray="4 2"
          ifOverflow="extendDomain"
          label={{
            value: "Budget Ceiling",
            position: "insideTopRight",
            fontSize: 12,
          }}
        />
        <Line
          type="monotone"
          dataKey="historical"
          stroke="var(--color-historical)"
          strokeWidth={2}
          dot={false}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="projected"
          stroke="var(--color-projected)"
          strokeWidth={2}
          strokeDasharray="5 5"
          dot={false}
          connectNulls={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
