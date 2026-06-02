"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import type { PacingRow } from "@/types";
import { cn, formatCurrency } from "@/lib/utils";

const config: ChartConfig = {
  current: { label: "Current month", color: "var(--chart-1)" },
  currentProjected: { label: "Projected", color: "var(--chart-1)" },
  m1: { label: "1 month ago", color: "var(--chart-3)" },
  m2: { label: "2 months ago", color: "var(--chart-4)" },
  m3: { label: "3 months ago", color: "var(--chart-5)" },
};

function monthLabelOffset(offset: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
  return d.toLocaleString("en-US", { month: "short" });
}

export function CumulativePacingChart({
  rows,
  budgetLimitCents,
  projectedEomCents,
  todayDayOfMonth,
  daysInMonth,
  todayEstimateCents = null,
}: {
  rows: PacingRow[];
  budgetLimitCents: number | null;
  projectedEomCents: number;
  todayDayOfMonth: number;
  daysInMonth: number;
  /** Spec 033 — when present, anchor the projection at today using MTD + est. */
  todayEstimateCents?: number | null;
}) {
  const monthName = new Date().toLocaleString("en-US", { month: "long" });

  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Not enough historical data to chart cumulative pacing.
      </p>
    );
  }

  // Anchor the (solid) actuals at the latest known cumulative ≤ today. The
  // cost_report source lags by a day, so this is normally yesterday.
  const sortedDays = [...rows].sort((a, b) => a.dayOfMonth - b.dayOfMonth);
  const anchorRow = [...sortedDays]
    .reverse()
    .find((r) => r.dayOfMonth <= todayDayOfMonth && r.current != null);
  const anchorDay = anchorRow?.dayOfMonth ?? null;
  const anchorCents = anchorRow?.current ?? null;

  // Spec 033 — when we have a today estimate, move the projection anchor forward
  // to today at (last actual cumulative + est today), so the dashed line crosses
  // the budget at the right date instead of lagging a day behind.
  const hasEstimate =
    todayEstimateCents != null &&
    todayEstimateCents > 0 &&
    anchorCents != null &&
    anchorDay != null &&
    todayDayOfMonth > anchorDay;
  const todayCumulativeCents =
    hasEstimate && anchorCents != null ? anchorCents + todayEstimateCents! : null;

  // Projection points: (anchorDay, anchorCents) keeps it continuous with the
  // solid line; (today, anchor + est) shows the estimated bump; (daysInMonth,
  // projectedEom) terminates it. Recharts connects them in order.
  function projectionAt(dayOfMonth: number): number | null {
    if (anchorDay == null || anchorCents == null) return null;
    if (dayOfMonth === anchorDay) return anchorCents / 100;
    if (hasEstimate && dayOfMonth === todayDayOfMonth && todayCumulativeCents != null)
      return todayCumulativeCents / 100;
    if (dayOfMonth === daysInMonth) return projectedEomCents / 100;
    return null;
  }

  const data = rows.map((r) => {
    const isPastAnchor = anchorDay != null && r.dayOfMonth > anchorDay;
    return {
      day: r.dayOfMonth,
      current: !isPastAnchor && r.current != null ? r.current / 100 : null,
      currentProjected: projectionAt(r.dayOfMonth),
      m1: r.m1 != null ? r.m1 / 100 : null,
      m2: r.m2 != null ? r.m2 / 100 : null,
      m3: r.m3 != null ? r.m3 / 100 : null,
    };
  });

  // Ensure the projection has its end anchor even if the rows array doesn't
  // include `daysInMonth` (cumulative pacing only emits days that have data).
  if (
    anchorCents != null &&
    anchorDay != null &&
    anchorDay < daysInMonth &&
    !data.some((d) => d.day === daysInMonth)
  ) {
    data.push({
      day: daysInMonth,
      current: null,
      currentProjected: projectedEomCents / 100,
      m1: null,
      m2: null,
      m3: null,
    });
  }

  // Y-axis upper bound: include the budget cap and the projected end-of-month
  // so both reference lines are visible above the highest data point.
  const maxObservedDollars = data.reduce((acc, d) => {
    const candidates = [d.current, d.currentProjected, d.m1, d.m2, d.m3];
    for (const v of candidates) if (v != null) acc = Math.max(acc, v);
    return acc;
  }, 0);
  const yMax =
    Math.max(
      maxObservedDollars,
      budgetLimitCents != null ? budgetLimitCents / 100 : 0,
      projectedEomCents / 100
    ) * 1.1;

  // Tracking comparison: compare current's anchor day to the most recent prior
  // month with a value at the same day. Use the anchor row (latest non-null
  // current ≤ today), not strictly today, so the label stays meaningful when
  // today's data hasn't synced yet.
  let trackingLabel = "—";
  let trackingTone: "warn" | "muted" = "muted";
  if (anchorRow && anchorCents != null) {
    const candidates: { offset: number; cents: number }[] = [];
    if (anchorRow.m1 != null) candidates.push({ offset: 1, cents: anchorRow.m1 });
    if (anchorRow.m2 != null) candidates.push({ offset: 2, cents: anchorRow.m2 });
    if (anchorRow.m3 != null) candidates.push({ offset: 3, cents: anchorRow.m3 });
    const cmp = candidates[0];
    if (cmp && cmp.cents > 0) {
      const pct = Math.round(((anchorCents - cmp.cents) / cmp.cents) * 100);
      const sign = pct > 0 ? "+" : "";
      trackingLabel = `Day ${anchorRow.dayOfMonth}: tracking ${sign}${pct}% vs ${monthLabelOffset(cmp.offset)} at same day`;
      trackingTone = pct > 0 ? "warn" : "muted";
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">
          Cumulative pacing
        </span>
        <span className="text-muted-foreground">
          By day-of-month · this month vs. prior 3
        </span>
      </div>
      <ChartContainer config={config} className="h-[220px] w-full">
        <LineChart data={data} accessibilityLayer margin={{ top: 12, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="day"
            type="number"
            domain={[1, daysInMonth]}
            ticks={[1, 5, 10, 15, 20, 25, daysInMonth]}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
            tickFormatter={(v: number) => `${v}`}
          />
          <YAxis
            domain={[0, yMax]}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
            tickFormatter={(v: number) => `$${v.toFixed(0)}`}
          />
          {budgetLimitCents != null && (
            <ReferenceLine
              y={budgetLimitCents / 100}
              stroke="var(--destructive)"
              strokeDasharray="3 3"
              label={{
                value: `Budget ${formatCurrency(budgetLimitCents)}`,
                position: "insideTopRight",
                fill: "var(--destructive)",
                fontSize: 10,
              }}
            />
          )}
          <ReferenceLine
            x={todayDayOfMonth}
            stroke="var(--muted-foreground)"
            strokeDasharray="2 4"
            label={{
              value: "today",
              position: "insideTopLeft",
              fill: "var(--muted-foreground)",
              fontSize: 10,
            }}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                numberFormat="currency"
                indicator="line"
                labelFormatter={(label) => `Day ${label} of ${monthName}`}
                footer={
                  budgetLimitCents != null
                    ? { label: "Budget cap", value: formatCurrency(budgetLimitCents) }
                    : undefined
                }
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
          <Line
            dataKey="currentProjected"
            type="linear"
            stroke="var(--chart-1)"
            strokeOpacity={0.85}
            strokeWidth={2}
            strokeDasharray="4 3"
            dot={false}
            connectNulls
          />
        </LineChart>
      </ChartContainer>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <ul className="flex flex-wrap items-center gap-3">
          <LineSwatch color="var(--chart-1)" label="this month" />
          <LineSwatch
            color="var(--chart-1)"
            label={hasEstimate ? "projection · incl. est. today" : "projection"}
            dashed
          />
          <LineSwatch color="#a1a1aa" label={`${monthLabelOffset(1)} (prior)`} />
          <LineSwatch color="#71717a" label={monthLabelOffset(2)} />
          <LineSwatch color="#52525b" label={monthLabelOffset(3)} />
        </ul>
        <span
          className={cn(
            "font-medium",
            trackingTone === "warn" ? "text-amber-400" : "text-muted-foreground"
          )}
        >
          {trackingLabel}
        </span>
      </div>
    </div>
  );
}

function LineSwatch({
  color,
  label,
  dashed = false,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <li className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-0.5 w-3"
        style={{
          backgroundColor: dashed ? "transparent" : color,
          borderTop: dashed ? `2px dashed ${color}` : undefined,
        }}
      />
      {label}
    </li>
  );
}
