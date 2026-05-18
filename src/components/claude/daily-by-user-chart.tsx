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

/**
 * Spectral palette by rank — mirrors `FALLBACK_PALETTE` in
 * `global-metrics-client.tsx` and `top-users-bar-chart.tsx` so the workspace
 * tab and the users tab feel like the same family of visuals. No per-user
 * `display_color` exists on the Anthropic side, so we always paint by rank.
 */
const PALETTE = [
  "#d4f057",
  "#86efac",
  "#67e8f9",
  "#93c5fd",
  "#c4b5fd",
  "#f9a8d4",
  "#fcd34d",
  "#fdba74",
];

function colorForSeries(key: string, idx: number): string {
  if (key === OTHER_KEY) return "#71717a";
  return PALETTE[idx % PALETTE.length];
}

export function DailyByUserChart({ data }: { data: DailyByUserResult }) {
  const seriesWithColors = useMemo(
    () =>
      data.topUsers.map((s, idx) => ({
        ...s,
        color: colorForSeries(s.key, idx),
      })),
    [data.topUsers]
  );

  const chartConfig = useMemo<ChartConfig>(() => {
    const out: ChartConfig = {};
    for (const s of seriesWithColors) {
      out[s.key] = { label: s.name, color: s.color };
    }
    return out;
  }, [seriesWithColors]);

  const chartData = useMemo(
    () =>
      data.days.map((d) => {
        const row: Record<string, number | string> = { date: d.date };
        for (const s of seriesWithColors) {
          row[s.key] = (d.perUser[s.key] ?? 0) / 100;
        }
        return row;
      }),
    [data.days, seriesWithColors]
  );

  const periodTotal = data.topUsers.reduce((s, u) => s + u.totalCents, 0);
  const topCount = seriesWithColors.filter((s) => s.key !== OTHER_KEY).length;
  const hasOther = seriesWithColors.some((s) => s.key === OTHER_KEY);

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
                    numberFormat="currency"
                    labelFormatter={(label) => formatDateLong(String(label))}
                    showTotal
                    secondaryFormatter={shareOfTotalFormatter("of day")}
                    sort="desc"
                  />
                }
              />
              <Legend wrapperStyle={{ paddingTop: 8 }} verticalAlign="top" />
              {seriesWithColors.map((s, idx) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  stackId="users"
                  fill={s.color}
                  name={s.name}
                  radius={
                    idx === seriesWithColors.length - 1
                      ? [4, 4, 0, 0]
                      : [0, 0, 0, 0]
                  }
                />
              ))}
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
