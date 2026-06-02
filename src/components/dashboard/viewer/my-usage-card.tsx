"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { SegmentedBar } from "@/components/ui/segmented-bar";
import { formatCurrency } from "@/lib/utils";
import type { CostData } from "@/types";
import type { ViewerModelTotal } from "@/actions/dashboard";

interface MyUsageCardProps {
  cost: CostData;
  modelTotals: ViewerModelTotal[];
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheReadTokens: number;
  uncachedInputTokens: number;
  cacheSavingsCents: number;
}

const chartConfig: ChartConfig = {
  cost: { label: "Spend", color: "var(--chart-1)" },
};

export function MyUsageCard({
  cost,
  modelTotals,
  cacheReadTokens,
  uncachedInputTokens,
  cacheSavingsCents,
}: MyUsageCardProps) {
  if (!cost.available || !cost.dailyBreakdown || cost.dailyBreakdown.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Claude API usage</CardTitle>
          <CardDescription>
            Daily spend · current month · all models combined
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {cost.error ?? "No usage data yet for this month."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const data = cost.dailyBreakdown.map((day) => ({
    date: day.date,
    cost: day.totalCents,
    label: new Date(day.date).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
  }));

  const totalCacheInput = cacheReadTokens + uncachedInputTokens;
  const cacheHitRate =
    totalCacheInput > 0 ? Math.round((cacheReadTokens / totalCacheInput) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>My Claude API usage</CardTitle>
        <CardDescription>
          Daily spend · current month · all models combined
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-5 lg:grid-cols-[1fr_180px]">
          <div>
            <p className="text-3xl font-semibold tabular-nums">
              {formatCurrency(cost.monthlyTotalCents)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Month to date
              {cost.latestDataDate ? ` · data through ${cost.latestDataDate}` : ""}
            </p>

            <ChartContainer
              config={chartConfig}
              className="mt-3 h-[160px] w-full"
            >
              <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="viewerSpendArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tickFormatter={(v) => {
                    const dollars = Number(v) / 100;
                    return dollars >= 1000
                      ? `$${(dollars / 1000).toFixed(1)}k`
                      : `$${dollars.toFixed(0)}`;
                  }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  tick={{ fontSize: 10 }}
                />
                <ReferenceLine
                  x={data.find((d) => d.date === todayStr)?.label ?? undefined}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="2 3"
                  strokeOpacity={0.5}
                />
                <ChartTooltip
                  cursor={{ stroke: "var(--muted)", strokeWidth: 1 }}
                  content={
                    <ChartTooltipContent
                      labelKey="label"
                      valueFormatter={(v) => formatCurrency(Number(v))}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="cost"
                  stroke="var(--chart-1)"
                  strokeWidth={1.75}
                  fill="url(#viewerSpendArea)"
                />
              </AreaChart>
            </ChartContainer>
          </div>

          <div className="border-l pl-5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              By model
            </p>
            <ul className="mt-3 space-y-2.5">
              {modelTotals.length === 0 && (
                <li className="text-xs text-muted-foreground">
                  No model usage yet.
                </li>
              )}
              {modelTotals.slice(0, 4).map((m, i) => (
                <li key={m.model}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 truncate">
                      <span
                        className="inline-block size-2.5 shrink-0 rounded-full"
                        style={{ background: `var(--chart-${(i % 4) + 1})` }}
                      />
                      <span className="truncate" title={m.model}>
                        {m.model}
                      </span>
                    </span>
                    <span className="tabular-nums text-foreground">
                      {formatCurrency(m.costCents)}
                    </span>
                  </div>
                  <div className="mt-1">
                    <SegmentedBar value={m.pct / 100} size="compact" />
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                    {m.pct}%
                  </p>
                </li>
              ))}
            </ul>

            {totalCacheInput > 0 && (
              <div className="mt-4 border-t pt-3 text-[11px] text-muted-foreground">
                Cache hit rate{" "}
                <span className="text-foreground tabular-nums">
                  {cacheHitRate}%
                </span>
                {cacheSavingsCents > 0 && (
                  <>
                    {" "}
                    · saved{" "}
                    <span className="text-success tabular-nums">
                      ~{formatCurrency(cacheSavingsCents)}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
