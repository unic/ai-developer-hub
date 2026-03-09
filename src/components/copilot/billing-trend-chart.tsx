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

interface BillingTrendChartProps {
  data: Array<{
    month: string;
    totalCostCents: number;
    totalSeats: number;
    activeSeats: number;
  }>;
}

const chartConfig = {
  totalCostCents: {
    label: "Monthly Cost",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export function BillingTrendChart({ data }: BillingTrendChartProps) {
  if (data.length === 0) {
    return null;
  }

  const formatted = data.map((d) => ({ ...d, cost: d.totalCostCents / 100 }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost Trend</CardTitle>
        <CardDescription>Monthly Copilot costs over time</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={chartConfig}
          className="min-h-[300px] w-full"
        >
          <BarChart data={formatted} accessibilityLayer>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(v: string) => {
                const d = new Date(v);
                return d.toLocaleDateString("en-US", {
                  month: "short",
                  year: "2-digit",
                });
              }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(v: number) => `$${v}`}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) =>
                    `$${(value as number).toFixed(2)}`
                  }
                />
              }
            />
            <Bar
              dataKey="cost"
              fill="var(--color-totalCostCents)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
