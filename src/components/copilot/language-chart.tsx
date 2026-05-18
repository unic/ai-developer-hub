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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface LanguageChartProps {
  data: Array<{
    language: string;
    suggestions: number;
    acceptances: number;
    acceptanceRate: number;
  }>;
}

const chartConfig = {
  suggestions: {
    label: "Suggestions",
    color: "var(--chart-1)",
  },
  acceptances: {
    label: "Acceptances",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

export function LanguageChart({ data }: LanguageChartProps) {
  if (data.length === 0) {
    return null;
  }

  const sorted = [...data]
    .sort((a, b) => b.suggestions - a.suggestions)
    .slice(0, 15);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Language Breakdown</CardTitle>
        <CardDescription>
          Top languages by Copilot suggestions and acceptances
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={chartConfig}
          className="min-h-[400px] w-full"
        >
          <BarChart data={sorted} layout="vertical" accessibilityLayer>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tickLine={false} axisLine={false} />
            <YAxis
              dataKey="language"
              type="category"
              tickLine={false}
              axisLine={false}
              width={100}
            />
            <ChartTooltip
              content={<ChartTooltipContent numberFormat="integer" />}
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar
              dataKey="suggestions"
              fill="var(--color-suggestions)"
              radius={[0, 4, 4, 0]}
            />
            <Bar
              dataKey="acceptances"
              fill="var(--color-acceptances)"
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
