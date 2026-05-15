"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import type { PacingRow } from "@/types";

const config: ChartConfig = {
  current: { label: "Current month", color: "var(--chart-1)" },
  m1: { label: "1 month ago", color: "#a1a1aa" },
  m2: { label: "2 months ago", color: "#71717a" },
  m3: { label: "3 months ago", color: "#52525b" },
};

export function CumulativePacingChart({ rows }: { rows: PacingRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Not enough historical data to chart cumulative pacing.
      </p>
    );
  }
  const data = rows.map((r) => ({
    day: r.dayOfMonth,
    current: r.current != null ? r.current / 100 : null,
    m1: r.m1 != null ? r.m1 / 100 : null,
    m2: r.m2 != null ? r.m2 / 100 : null,
    m3: r.m3 != null ? r.m3 / 100 : null,
  }));

  return (
    <ChartContainer config={config} className="h-[220px] w-full">
      <LineChart data={data} accessibilityLayer margin={{ top: 12, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          tickFormatter={(v: number) => `${v}`}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          tickFormatter={(v: number) => `$${v.toFixed(0)}`}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) => [
                value == null ? "—" : `$${Number(value).toFixed(2)}`,
                config[name as string]?.label ?? name,
              ]}
            />
          }
        />
        <Line
          dataKey="m3"
          type="monotone"
          stroke="#52525b"
          strokeWidth={1.5}
          dot={false}
          connectNulls
        />
        <Line
          dataKey="m2"
          type="monotone"
          stroke="#71717a"
          strokeWidth={1.5}
          dot={false}
          connectNulls
        />
        <Line
          dataKey="m1"
          type="monotone"
          stroke="#a1a1aa"
          strokeWidth={1.5}
          dot={false}
          connectNulls
        />
        <Line
          dataKey="current"
          type="monotone"
          stroke="var(--chart-1)"
          strokeWidth={2.5}
          dot={false}
          connectNulls={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
