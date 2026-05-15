"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis, Cell } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import type { TwelveMonthRow } from "@/types";
import { formatCurrency } from "@/lib/utils";

const config: ChartConfig = {
  total: { label: "Spend", color: "var(--chart-1)" },
};

export function TwelveMonthBarChart({ rows }: { rows: TwelveMonthRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No historical data yet.
      </p>
    );
  }
  const cap = rows[0]?.budgetLimitCents ?? null;

  const data = rows.map((r) => ({
    month: r.month,
    total: r.totalCents / 100,
    overCap: cap != null && r.totalCents > cap,
  }));

  return (
    <ChartContainer config={config} className="h-[220px] w-full">
      <BarChart data={data} accessibilityLayer margin={{ top: 12, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          tickFormatter={(value: string) => {
            const [, m] = value.split("-");
            return new Date(2000, Number(m) - 1, 1).toLocaleString("en-US", { month: "short" });
          }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          tickFormatter={(value: number) => `$${value.toFixed(0)}`}
        />
        {cap != null && (
          <ReferenceLine
            y={cap / 100}
            stroke="hsl(var(--destructive))"
            strokeDasharray="3 3"
            label={{ value: `Budget ${formatCurrency(cap)}`, position: "insideTopRight", fill: "hsl(var(--destructive))", fontSize: 10 }}
          />
        )}
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => `$${Number(value).toFixed(2)}`}
            />
          }
        />
        <Bar dataKey="total" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={d.overCap ? "hsl(var(--destructive))" : "var(--chart-1)"}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
