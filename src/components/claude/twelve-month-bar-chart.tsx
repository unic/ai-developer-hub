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
  projected: { label: "Projected", color: "var(--chart-1)" },
};

// Greyscale ramp by month age, matching mockup.html:392-404.
const GREY_RAMP = ["#a1a1aa", "#71717a", "#52525b", "#3f3f46"] as const;

function fillForAge(monthsBack: number, overCap: boolean): string {
  if (overCap) return "hsl(var(--destructive))";
  if (monthsBack === 0) return "var(--chart-1)";
  if (monthsBack <= 2) return GREY_RAMP[0];
  if (monthsBack <= 5) return GREY_RAMP[1];
  if (monthsBack <= 7) return GREY_RAMP[2];
  return GREY_RAMP[3];
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
  });
}

export function TwelveMonthBarChart({
  rows,
  currentMonth,
  projectedMonthEndCents,
}: {
  rows: TwelveMonthRow[];
  currentMonth: string;
  projectedMonthEndCents: number;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No historical data yet.
      </p>
    );
  }
  const cap = rows[0]?.budgetLimitCents ?? null;
  const lastIdx = rows.length - 1;

  const data = rows.map((r, i) => {
    const monthsBack = lastIdx - i;
    const isCurrent = r.month === currentMonth;
    const overCap = cap != null && r.totalCents > cap;
    const total = r.totalCents / 100;
    const projectedStub =
      isCurrent && projectedMonthEndCents > r.totalCents
        ? (projectedMonthEndCents - r.totalCents) / 100
        : null;
    return {
      month: r.month,
      total,
      projected: projectedStub,
      fill: fillForAge(monthsBack, overCap),
    };
  });

  const firstLabel = monthLabel(rows[0].month);
  const lastLabel = monthLabel(rows[lastIdx].month);

  const maxStackedValue = data.reduce(
    (acc, d) => Math.max(acc, d.total + (d.projected ?? 0)),
    0
  );
  const yMax =
    (cap != null
      ? Math.max(maxStackedValue, cap / 100)
      : maxStackedValue) * 1.1;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">
          Monthly totals
        </span>
        <span className="text-muted-foreground">
          {firstLabel} → {lastLabel} (projected)
        </span>
      </div>
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
            domain={[0, yMax]}
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
                formatter={(value) =>
                  value == null ? "—" : `$${Number(value).toFixed(2)}`
                }
              />
            }
          />
          <Bar dataKey="total" stackId="month" radius={[0, 0, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={`actual-${i}`} fill={d.fill} />
            ))}
          </Bar>
          <Bar dataKey="projected" stackId="month" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => (
              <Cell
                key={`proj-${i}`}
                fill="var(--chart-1)"
                fillOpacity={0.28}
                stroke="var(--chart-1)"
                strokeOpacity={0.6}
                strokeDasharray="3 3"
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
      <ul className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <LegendSwatch color="var(--chart-1)" label="this month" />
        <LegendSwatch
          color="var(--chart-1)"
          label="projected"
          opacity={0.28}
          dashed
        />
        <LegendSwatch color={GREY_RAMP[0]} label="prior month" />
        <LegendSwatch color={GREY_RAMP[3]} label="older" />
      </ul>
    </div>
  );
}

function LegendSwatch({
  color,
  label,
  opacity = 1,
  dashed = false,
}: {
  color: string;
  label: string;
  opacity?: number;
  dashed?: boolean;
}) {
  return (
    <li className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-2.5 w-3 rounded-sm"
        style={{
          backgroundColor: color,
          opacity,
          border: dashed ? `1px dashed ${color}` : undefined,
        }}
      />
      {label}
    </li>
  );
}
