"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface EditorChartProps {
  data: Array<{
    editor: string;
    engagedUsers: number;
    suggestions: number;
    acceptances: number;
  }>;
}

const chartConfig = {
  engagedUsers: {
    label: "Engaged Users",
    color: "var(--chart-1)",
  },
  suggestions: {
    label: "Suggestions",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

export function EditorChart({ data }: EditorChartProps) {
  if (data.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Editor Breakdown</CardTitle>
        <CardDescription>Copilot usage by IDE/editor</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={chartConfig}
          className="min-h-[300px] w-full"
        >
          <BarChart data={data} accessibilityLayer>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="editor"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <YAxis tickLine={false} axisLine={false} />
            <ChartTooltip
              content={<ChartTooltipContent numberFormat="integer" />}
            />
            <Bar
              dataKey="engagedUsers"
              fill="var(--color-engagedUsers)"
              radius={[4, 4, 0, 0]}
            />
            <Bar
              dataKey="suggestions"
              fill="var(--color-suggestions)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
