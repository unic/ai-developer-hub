"use client";

import { useState, useTransition, useMemo, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
import { formatDateLong, shareOfTotalFormatter } from "@/lib/chart-format";
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

function resolveSeriesColor(
  key: string,
  displayColor: string | null,
  idx: number,
  useDbColors: boolean
): string {
  if (key === OTHER_KEY) return "#71717a";
  if (useDbColors && displayColor && displayColor.trim()) return displayColor;
  // Spectral assignment by rank: top-spend workspace gets palette[0], next
  // gets palette[1], etc. Trade-off: a workspace's color follows its rank,
  // so it can shift when spend ordering changes. Worth it for the visual.
  return FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length];
}

type StackedSeries = {
  key: string;
  name: string;
  displayColor: string | null;
};

const ALL_WORKSPACES = "__all__";
const OTHER_KEY = "__other__";
const DEFAULT_KEY = "__default__";
// Spec 033 — trailing "today (est.)" ghost bar. Mirrors STACKED_ESTIMATE_KEY in
// anthropic-global.ts (same intentional duplication as OTHER_KEY/DEFAULT_KEY).
const ESTIMATE_KEY = "__estimated__";

type GlobalMetricsClientProps = {
  initialKpis: DashboardKpis;
  initialDaily: { rows: DailyStackedRow[]; topWorkspaces: StackedSeries[] };
  availableMonths: string[];
  initialMonth: string;
  orgBudgetCents: number | null;
  syncStatus: SyncStatus;
  workspaceOptions: { key: string; name: string }[];
};

export function GlobalMetricsClient({
  initialKpis,
  initialDaily,
  availableMonths,
  initialMonth,
  orgBudgetCents,
  syncStatus,
  workspaceOptions,
}: GlobalMetricsClientProps) {
  const [kpis, setKpis] = useState<DashboardKpis>(initialKpis);
  const [daily, setDaily] = useState(initialDaily);
  const [selectedMonth, setSelectedMonth] = useState<string>(initialMonth);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>(ALL_WORKSPACES);
  const [useDbColors, setUseDbColors] = useState<boolean>(false);
  const [isPending, startTransition] = useTransition();

  // Persist the color-source preference across reloads (localStorage). The
  // default is the theme palette — distinct hues out of the box; the DB's
  // display_color values from the Anthropic Admin API often collide.
  useEffect(() => {
    const saved = localStorage.getItem("claude-dashboard:useDbColors");
    if (saved === "true") setUseDbColors(true);
  }, []);
  useEffect(() => {
    localStorage.setItem(
      "claude-dashboard:useDbColors",
      String(useDbColors)
    );
  }, [useDbColors]);

  // Honor the ?workspace=<id> query param when returning from the
  // workspace detail page breadcrumb. "default" → the NULL workspace.
  const searchParams = useSearchParams();
  useEffect(() => {
    const ws = searchParams.get("workspace");
    if (!ws) return;
    const key = ws === "default" ? DEFAULT_KEY : ws;
    if (workspaceOptions.some((w) => w.key === key)) {
      setSelectedWorkspace(key);
    }
  }, [searchParams, workspaceOptions]);

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
        todayEstimate: kpis.todayEstimate,
      }),
    [kpis, orgBudgetCents, selectedMonth]
  );

  const seriesWithColors = useMemo(
    () =>
      daily.topWorkspaces.map((s, idx) => ({
        ...s,
        color: resolveSeriesColor(s.key, s.displayColor, idx, useDbColors),
      })),
    [daily.topWorkspaces, useDbColors]
  );

  const chartConfig = useMemo<ChartConfig>(() => {
    const out: ChartConfig = {};
    for (const s of seriesWithColors) {
      out[s.key] = { label: s.name, color: s.color };
    }
    out[ESTIMATE_KEY] = { label: "Today (est.)", color: "var(--chart-1)" };
    return out;
  }, [seriesWithColors]);

  // The daily chart's series come from `topWorkspaces` (top 8 + "Other"), so
  // restrict the dropdown to keys that actually have a series — otherwise
  // selecting a non-top workspace renders an empty chart. Workspaces outside
  // the top 8 still show up in the workspace budget list and sparklines below.
  const seriesKeys = useMemo(
    () => new Set(seriesWithColors.map((s) => s.key)),
    [seriesWithColors]
  );
  const filterableOptions = useMemo(
    () => workspaceOptions.filter((w) => seriesKeys.has(w.key)),
    [workspaceOptions, seriesKeys]
  );

  // Fall back to "All workspaces" if a previously-selected workspace dropped
  // out of the top 8 between renders (e.g., a month switch reshuffles ranks).
  useEffect(() => {
    if (
      selectedWorkspace !== ALL_WORKSPACES &&
      !seriesKeys.has(selectedWorkspace)
    ) {
      setSelectedWorkspace(ALL_WORKSPACES);
    }
  }, [selectedWorkspace, seriesKeys]);

  const visibleSeries = useMemo(
    () =>
      selectedWorkspace === ALL_WORKSPACES
        ? seriesWithColors
        : seriesWithColors.filter((s) => s.key === selectedWorkspace),
    [seriesWithColors, selectedWorkspace]
  );

  // Spec 033 — the server appends one trailing "today (est.)" row carrying the
  // estimate under ESTIMATE_KEY. Render its ghost bar only in the org-wide view
  // (the estimate is a single org/total figure, not per-workspace here).
  const showEstimate =
    selectedWorkspace === ALL_WORKSPACES && daily.rows.some((d) => d.estimated);

  const chartData = useMemo(
    () =>
      daily.rows.map((d) => {
        const row: Record<string, number | string> = { date: d.date };
        for (const s of visibleSeries) {
          row[s.key] = (d.perWorkspace[s.key] ?? 0) / 100;
        }
        if (showEstimate) {
          row[ESTIMATE_KEY] = (d.perWorkspace[ESTIMATE_KEY] ?? 0) / 100;
        }
        return row;
      }),
    [daily.rows, visibleSeries, showEstimate]
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
          <Select
            value={selectedWorkspace}
            onValueChange={setSelectedWorkspace}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="All workspaces" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_WORKSPACES}>All workspaces</SelectItem>
              {filterableOptions.map((w) => (
                <SelectItem key={w.key} value={w.key}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-base">
                {selectedWorkspace === ALL_WORKSPACES
                  ? "Daily spend by workspace"
                  : `Daily spend · ${visibleSeries[0]?.name ?? "Workspace"}`}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {selectedWorkspace === ALL_WORKSPACES
                  ? `Stacked · top ${seriesWithColors.filter((s) => s.key !== OTHER_KEY).length} workspaces${seriesWithColors.some((s) => s.key === OTHER_KEY) ? " + Other" : ""}`
                  : "Single workspace · filtered view"}
                {" · "}
                <span className="tabular-nums">{formatCurrency(kpis.totalCents)}</span>{" "}
                this period
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="use-db-colors"
                checked={useDbColors}
                onCheckedChange={setUseDbColors}
              />
              <Label
                htmlFor="use-db-colors"
                className="cursor-pointer text-xs text-muted-foreground"
              >
                Use workspace colors
              </Label>
            </div>
          </div>
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
                <Legend wrapperStyle={{ paddingTop: 8 }} />
                {visibleSeries.map((s) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    stackId="costs"
                    fill={s.color}
                    name={s.name}
                    radius={
                      s.key === visibleSeries[visibleSeries.length - 1]?.key
                        ? [4, 4, 0, 0]
                        : [0, 0, 0, 0]
                    }
                  />
                ))}
                {showEstimate && (
                  <Bar
                    dataKey={ESTIMATE_KEY}
                    stackId="costs"
                    name="Today (est.)"
                    fill="var(--chart-1)"
                    fillOpacity={0.28}
                    stroke="var(--chart-1)"
                    strokeOpacity={0.6}
                    strokeDasharray="3 3"
                    radius={[4, 4, 0, 0]}
                  />
                )}
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
