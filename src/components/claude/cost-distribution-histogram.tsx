"use client";

import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from "recharts";
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
import type { UserCostDistributionBucket } from "@/types";

/**
 * Per-bucket color ramp — muted on the left (where "$0" lives, the boring
 * tail) → mid-tone in the middle (active users) → destructive on the right
 * (the high-cost long tail). Tokens come from the theme so dark / glitch /
 * pro variants stay coherent.
 */
const BUCKET_COLORS: Record<UserCostDistributionBucket["key"], string> = {
  zero: "var(--muted-foreground)",
  lt1: "var(--muted-foreground)",
  lt10: "var(--chart-3)",
  lt50: "var(--chart-3)",
  lt100: "var(--chart-1)",
  gte100: "var(--destructive)",
};

const config: ChartConfig = {
  userCount: { label: "Users", color: "var(--chart-1)" },
};

export function CostDistributionHistogram({
  buckets,
}: {
  buckets: UserCostDistributionBucket[];
}) {
  const total = buckets.reduce((s, b) => s + b.userCount, 0);

  const data = buckets.map((b) => ({
    key: b.key,
    label: b.label,
    userCount: b.userCount,
    fill: BUCKET_COLORS[b.key],
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Cost distribution</CardTitle>
        <CardDescription>
          How many users in each bracket{total > 0 ? ` · ${total} users with an API key` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No active users yet.
          </p>
        ) : (
          <ChartContainer config={config} className="h-[220px] w-full">
            <BarChart
              data={data}
              accessibilityLayer
              margin={{ top: 24, right: 8, bottom: 0, left: 8 }}
            >
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                tick={{ fontSize: 11 }}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => `${Number(value)} users`}
                  />
                }
              />
              <Bar dataKey="userCount" radius={[4, 4, 0, 0]} maxBarSize={56}>
                {data.map((d, i) => (
                  <Cell key={`bucket-${i}`} fill={d.fill} />
                ))}
                <LabelList
                  dataKey="userCount"
                  position="top"
                  className="fill-foreground tabular-nums"
                  fontSize={11}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
