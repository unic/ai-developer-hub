"use client";

import { useState, useTransition, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MonthPicker } from "@/components/profile/month-picker";
import {
  getDailyTotalsByWorkspace,
  getDashboardKpis,
} from "@/actions/anthropic-global";
import type {
  DailyStackedRow,
  DashboardKpis,
  SyncStatus,
} from "@/types";
import { formatCurrency } from "@/lib/utils";
import { KpiStrip, buildOrgKpiTiles } from "@/components/claude/kpi-strip";
import { SyncStatusPill } from "@/components/claude/sync-status-pill";

// Deterministic palette fallback when workspace.displayColor is null.
const FALLBACK_PALETTE = [
  "#d4f057",
  "#86efac",
  "#67e8f9",
  "#93c5fd",
  "#c4b5fd",
  "#f9a8d4",
  "#fcd34d",
  "#fdba74",
];

function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function resolveSeriesColor(
  key: string,
  displayColor: string | null,
  idx: number
): string {
  if (displayColor && displayColor.trim()) return displayColor;
  if (key === "__other__") return "#71717a";
  return FALLBACK_PALETTE[(hashKey(key) + idx) % FALLBACK_PALETTE.length];
}

type StackedSeries = {
  key: string;
  name: string;
  displayColor: string | null;
};

type GlobalMetricsClientProps = {
  initialKpis: DashboardKpis;
  initialDaily: { rows: DailyStackedRow[]; topWorkspaces: StackedSeries[] };
  availableMonths: string[];
  initialMonth: string;
  orgBudgetCents: number | null;
  syncStatus: SyncStatus;
};

export function GlobalMetricsClient({
  initialKpis,
  initialDaily,
  availableMonths,
  initialMonth,
  orgBudgetCents,
  syncStatus,
}: GlobalMetricsClientProps) {
  const [kpis, setKpis] = useState<DashboardKpis>(initialKpis);
  const [daily, setDaily] = useState(initialDaily);
  const [selectedMonth, setSelectedMonth] = useState<string>(initialMonth);
  const [isPending, startTransition] = useTransition();

  function handleMonthChange(newMonth: string) {
    setSelectedMonth(newMonth);
    startTransition(async () => {
      const [k, d] = await Promise.all([
        getDashboardKpis(newMonth),
        getDailyTotalsByWorkspace(newMonth),
      ]);
      setKpis(k);
      setDaily(d);
    });
  }

  const tiles = useMemo(
    () =>
      buildOrgKpiTiles({
        month: selectedMonth,
        totalCents: kpis.totalCents,
        momDeltaCents: kpis.momDeltaCents,
        momDeltaPct: kpis.momDeltaPct,
        priorMonthCents: kpis.priorMonthCents,
        projectedMonthEndCents: kpis.projectedMonthEndCents,
        orgBudgetCents,
        workspacesOverEightyCount: kpis.workspacesOverEightyCount,
        workspacesWithLimitCount: kpis.workspacesWithLimitCount,
        topOverWorkspaceName: kpis.topOverWorkspaceName,
        topOverWorkspaceUtilizationPct: kpis.topOverWorkspaceUtilizationPct,
      }),
    [kpis, orgBudgetCents, selectedMonth]
  );

  const seriesWithColors = useMemo(
    () =>
      daily.topWorkspaces.map((s, idx) => ({
        ...s,
        color: resolveSeriesColor(s.key, s.displayColor, idx),
      })),
    [daily.topWorkspaces]
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
      daily.rows.map((d) => {
        const row: Record<string, number | string> = { date: d.date };
        for (const s of seriesWithColors) {
          row[s.key] = (d.perWorkspace[s.key] ?? 0) / 100;
        }
        return row;
      }),
    [daily.rows, seriesWithColors]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <MonthPicker
            value={selectedMonth}
            onChange={handleMonthChange}
            months={availableMonths}
          />
          {isPending && (
            <span className="text-sm text-muted-foreground animate-pulse">
              Loading…
            </span>
          )}
        </div>
        <SyncStatusPill status={syncStatus} />
      </div>

      <KpiStrip tiles={tiles} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Daily spend by workspace</CardTitle>
          <p className="text-sm text-muted-foreground">
            Stacked · top {seriesWithColors.filter((s) => s.key !== "__other__").length}{" "}
            workspaces
            {seriesWithColors.some((s) => s.key === "__other__") && " + Other"} ·{" "}
            <span className="tabular-nums">{formatCurrency(kpis.totalCents)}</span>{" "}
            this period
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
                      formatter={(value, name) => [
                        `$${Number(value).toFixed(2)}`,
                        chartConfig[name as string]?.label ?? name,
                      ]}
                    />
                  }
                />
                <Legend wrapperStyle={{ paddingTop: 8 }} />
                {seriesWithColors.map((s) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    stackId="costs"
                    fill={s.color}
                    name={s.name}
                    radius={
                      s.key === seriesWithColors[seriesWithColors.length - 1].key
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
    </div>
  );
}
