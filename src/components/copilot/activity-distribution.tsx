"use client";

import { PieChart, Pie, Cell } from "recharts";
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
import { shareOfTotalFormatter } from "@/lib/chart-format";

interface ActivityDistributionProps {
  data: {
    powerUsers: number;
    regularUsers: number;
    occasionalUsers: number;
    inactiveUsers: number;
  };
}

const chartConfig = {
  powerUsers: {
    label: "Power Users (20+ days)",
    color: "var(--chart-1)",
  },
  regularUsers: {
    label: "Regular (5-19 days)",
    color: "var(--chart-2)",
  },
  occasionalUsers: {
    label: "Occasional (1-4 days)",
    color: "var(--chart-3)",
  },
  inactiveUsers: {
    label: "Inactive",
    color: "var(--chart-4)",
  },
} satisfies ChartConfig;

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
];

export function ActivityDistribution({ data }: ActivityDistributionProps) {
  const total =
    data.powerUsers +
    data.regularUsers +
    data.occasionalUsers +
    data.inactiveUsers;

  if (total === 0) {
    return null;
  }

  const pieData = [
    { name: "powerUsers", value: data.powerUsers },
    { name: "regularUsers", value: data.regularUsers },
    { name: "occasionalUsers", value: data.occasionalUsers },
    { name: "inactiveUsers", value: data.inactiveUsers },
  ].filter((d) => d.value > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Distribution</CardTitle>
        <CardDescription>
          User engagement levels across {total} total seats
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={chartConfig}
          className="mx-auto aspect-square max-h-[300px]"
        >
          <PieChart accessibilityLayer>
            <ChartTooltip
              content={
                <ChartTooltipContent
                  nameKey="name"
                  numberFormat="integer"
                  secondaryFormatter={shareOfTotalFormatter("of seats")}
                />
              }
            />
            <ChartLegend
              content={<ChartLegendContent nameKey="name" />}
            />
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={2}
            >
              {pieData.map((entry, index) => (
                <Cell
                  key={entry.name}
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
