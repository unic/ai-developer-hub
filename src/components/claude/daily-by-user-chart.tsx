"use client";

import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { formatDateLong, shareOfTotalFormatter } from "@/lib/chart-format";
import type { DailyByUserResult } from "@/types";

const OTHER_KEY = "__other__";

// Cap distinct stacked segments — greyscale has only ~4-5 perceptually-distinct
// steps, so lower-ranked users fold into "Other". Full detail stays in the
// tooltip + the users table below. Mirrors the workspace tab's daily chart.
const MAX_STACK = 4;

// Monotonic greyscale ramp by rank (no repeats) → distinguishable adjacent
// segments + a legend that reads as a rank gradient.
const MONO_RAMP = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

type RenderSeries = {
  key: string;
  name: string;
  color: string;
  overflowKeys: string[];
};

export function DailyByUserChart({ data }: { data: DailyByUserResult }) {
  // Top MAX_STACK users + an aggregated "Other" (overflow ranks + the server's
  // existing Other bucket); colour by stack position via the monotonic ramp.
  const stackedSeries = useMemo<RenderSeries[]>(() => {
    const real = data.topUsers.filter((s) => s.key !== OTHER_KEY);
    const top = real.slice(0, MAX_STACK);
    const overflowKeys = real.slice(MAX_STACK).map((s) => s.key);
    const hasOtherBucket =
      overflowKeys.length > 0 || data.topUsers.some((s) => s.key === OTHER_KEY);
    const out: RenderSeries[] = top.map((s, i) => ({
      key: s.key,
      name: s.name,
      color: MONO_RAMP[Math.min(i, MONO_RAMP.length - 1)],
      overflowKeys: [],
    }));
    if (hasOtherBucket) {
      out.push({
        key: OTHER_KEY,
        name: "Other",
        color: MONO_RAMP[Math.min(out.length, MONO_RAMP.length - 1)],
        overflowKeys,
      });
    }
    return out;
  }, [data.topUsers]);

  const chartConfig = useMemo<ChartConfig>(() => {
    const out: ChartConfig = {};
    for (const s of stackedSeries) {
      out[s.key] = { label: s.name, color: s.color };
    }
    return out;
  }, [stackedSeries]);

  const chartData = useMemo(
    () =>
      data.days.map((d) => {
        const row: Record<string, number | string> = { date: d.date };
        for (const s of stackedSeries) {
          if (s.key === OTHER_KEY) {
            let sum = d.perUser[OTHER_KEY] ?? 0;
            for (const k of s.overflowKeys) sum += d.perUser[k] ?? 0;
            row[OTHER_KEY] = sum / 100;
          } else {
            row[s.key] = (d.perUser[s.key] ?? 0) / 100;
          }
        }
        return row;
      }),
    [data.days, stackedSeries]
  );

  const periodTotal = data.topUsers.reduce((s, u) => s + u.totalCents, 0);
  const topCount = stackedSeries.filter((s) => s.key !== OTHER_KEY).length;
  const hasOther = stackedSeries.some((s) => s.key === OTHER_KEY);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Daily spend by user</CardTitle>
        <p className="text-sm text-muted-foreground">
          Stacked · top {topCount} users{hasOther ? " + Other" : ""}
          {periodTotal > 0 && (
            <>
              {" · "}
              <span className="tabular-nums">{formatCurrency(periodTotal)}</span>{" "}
              this period
            </>
          )}
        </p>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No data for this period.
          </p>
        ) : (
          <ChartContainer config={chartConfig} className="min-h-[320px] w-full">
            <BarChart data={chartData} accessibilityLayer>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
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
                    numberFormat="currency"
                    labelFormatter={(label) => formatDateLong(String(label))}
                    showTotal
                    secondaryFormatter={shareOfTotalFormatter("of day")}
                    sort="desc"
                  />
                }
              />
              <Legend wrapperStyle={{ paddingTop: 8 }} verticalAlign="top" />
              {stackedSeries.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  stackId="users"
                  fill={s.color}
                  name={s.name}
                  radius={[0, 0, 0, 0]}
                  stroke="var(--card)"
                  strokeWidth={1}
                />
              ))}
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
