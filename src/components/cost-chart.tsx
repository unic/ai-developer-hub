"use client";

import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import type { DailyBreakdown } from "@/types";

// Color palette for models
const MODEL_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function formatModelName(model: string): string {
  // "claude-opus-4-6" → "Opus 4.6"
  const match = model.match(/claude-(\w+)-(\d+)(?:-(\d+))?/);
  if (match) {
    const name = match[1].charAt(0).toUpperCase() + match[1].slice(1);
    const version = match[3] ? `${match[2]}.${match[3]}` : match[2];
    return `${name} ${version}`;
  }
  return model;
}

type CostChartProps = {
  dailyBreakdown: DailyBreakdown[];
};

export function CostChart({ dailyBreakdown }: CostChartProps) {
  // Extract unique models and build chart config + data
  const { chartData, chartConfig, modelKeys } = useMemo(() => {
    const modelSet = new Set<string>();
    for (const day of dailyBreakdown) {
      for (const m of day.models) {
        modelSet.add(m.model);
      }
    }
    const models = Array.from(modelSet).sort();

    const config: ChartConfig = {};
    models.forEach((model, i) => {
      config[model] = {
        label: formatModelName(model),
        color: MODEL_COLORS[i % MODEL_COLORS.length],
      };
    });

    const data = dailyBreakdown.map((day) => {
      const point: Record<string, string | number> = { date: day.date };
      for (const m of day.models) {
        point[m.model] = m.costCents / 100; // Convert cents to dollars for display
      }
      return point;
    });

    return { chartData: data, chartConfig: config, modelKeys: models };
  }, [dailyBreakdown]);

  if (dailyBreakdown.length === 0) {
    return null;
  }

  return (
    <ChartContainer config={chartConfig} className="min-h-[300px] w-full">
      <BarChart data={chartData} accessibilityLayer>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(value: string) => {
            const date = new Date(value + "T00:00:00");
            return date.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });
          }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(value: number) => `$${value.toFixed(0)}`}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => `$${Number(value).toFixed(2)}`}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {modelKeys.map((model, i) => (
          <Bar
            key={model}
            dataKey={model}
            stackId="cost"
            fill={MODEL_COLORS[i % MODEL_COLORS.length]}
            radius={
              i === modelKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]
            }
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
