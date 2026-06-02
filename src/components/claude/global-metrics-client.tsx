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
import type { DailyStackedRow, DashboardKpis, SyncStatus } from "@/types";
import { formatCurrency } from "@/lib/utils";
import { formatDateLong, shareOfTotalFormatter } from "@/lib/chart-format";
import { KpiStrip, buildOrgKpiTiles } from "@/components/claude/kpi-strip";
import { SyncStatusPill } from "@/components/claude/sync-status-pill";
import { InlineSpinner } from "@/components/ui/loading-state";

// Max distinct workspace segments stacked in the "all workspaces" view. Beyond
// this, lower-ranked workspaces fold into "Other" — greyscale only has ~4-5
// perceptually-distinct steps, so a 9-deep grey stack is unreadable. Full
// per-workspace detail stays in the tooltip and the workspace budget list below.
const MAX_STACK = 4;

// Monotonic greyscale ramp by rank — one clean luminance step per segment (no
// repeats), so adjacent stacked segments stay distinguishable and the legend
// swatches read as a rank gradient. Paired with 1px surface-coloured separators
// on each bar (see the <Bar stroke=…> below).
const MONO_RAMP = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function seriesColor(
  key: string,
  displayColor: string | null,
  stackIdx: number,
  useDbColors: boolean,
): string {
  // "Use workspace colors" on → the workspace's own hue (still capped at ≤5
  // stacked segments, so even the colour mode stays legible).
  if (useDbColors && key !== OTHER_KEY && displayColor && displayColor.trim()) {
    return displayColor;
  }
  return MONO_RAMP[Math.min(stackIdx, MONO_RAMP.length - 1)];
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
  const [selectedWorkspace, setSelectedWorkspace] =
    useState<string>(ALL_WORKSPACES);
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
    localStorage.setItem("claude-dashboard:useDbColors", String(useDbColors));
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
    [kpis, orgBudgetCents, selectedMonth],
  );

  // Full server-provided series (top N + "Other") — used for the dropdown's
  // filter options so any top workspace can still be isolated.
  const allSeries = useMemo(
    () => daily.topWorkspaces.map((s) => ({ ...s })),
    [daily.topWorkspaces],
  );
  const seriesKeys = useMemo(
    () => new Set(allSeries.map((s) => s.key)),
    [allSeries],
  );
  const filterableOptions = useMemo(
    () => workspaceOptions.filter((w) => seriesKeys.has(w.key)),
    [workspaceOptions, seriesKeys],
  );

  // Fall back to "All workspaces" if a previously-selected workspace dropped
  // out of the top set between renders (e.g., a month switch reshuffles ranks).
  useEffect(() => {
    if (
      selectedWorkspace !== ALL_WORKSPACES &&
      !seriesKeys.has(selectedWorkspace)
    ) {
      setSelectedWorkspace(ALL_WORKSPACES);
    }
  }, [selectedWorkspace, seriesKeys]);

  // Rendered stack: a single workspace when filtered; otherwise the top
  // MAX_STACK workspaces + an aggregated "Other" (overflow ranks + the server's
  // existing Other bucket). Colours assigned by stack position → monotonic grey
  // ramp (or the workspace hue when "Use workspace colors" is on).
  type RenderSeries = {
    key: string;
    name: string;
    color: string;
    overflowKeys: string[];
  };
  const stackedSeries = useMemo<RenderSeries[]>(() => {
    if (selectedWorkspace !== ALL_WORKSPACES) {
      const s = allSeries.find((x) => x.key === selectedWorkspace);
      return s
        ? [
            {
              key: s.key,
              name: s.name,
              color: seriesColor(s.key, s.displayColor, 0, useDbColors),
              overflowKeys: [],
            },
          ]
        : [];
    }
    const real = allSeries.filter((s) => s.key !== OTHER_KEY);
    const top = real.slice(0, MAX_STACK);
    const overflowKeys = real.slice(MAX_STACK).map((s) => s.key);
    const hasOther =
      overflowKeys.length > 0 || allSeries.some((s) => s.key === OTHER_KEY);
    const out: RenderSeries[] = top.map((s, i) => ({
      key: s.key,
      name: s.name,
      color: seriesColor(s.key, s.displayColor, i, useDbColors),
      overflowKeys: [],
    }));
    if (hasOther) {
      out.push({
        key: OTHER_KEY,
        name: "Other",
        color: MONO_RAMP[Math.min(out.length, MONO_RAMP.length - 1)],
        overflowKeys,
      });
    }
    return out;
  }, [allSeries, selectedWorkspace, useDbColors]);

  const stackedTopCount = useMemo(
    () => stackedSeries.filter((s) => s.key !== OTHER_KEY).length,
    [stackedSeries],
  );
  const stackedHasOther = useMemo(
    () => stackedSeries.some((s) => s.key === OTHER_KEY),
    [stackedSeries],
  );

  const chartConfig = useMemo<ChartConfig>(() => {
    const out: ChartConfig = {};
    for (const s of stackedSeries) {
      out[s.key] = { label: s.name, color: s.color };
    }
    out[ESTIMATE_KEY] = { label: "Today (est.)", color: "var(--chart-1)" };
    return out;
  }, [stackedSeries]);

  // Spec 033 — the server appends one trailing "today (est.)" row carrying the
  // estimate under ESTIMATE_KEY. Render its ghost bar only in the org-wide view
  // (the estimate is a single org/total figure, not per-workspace here).
  const showEstimate =
    selectedWorkspace === ALL_WORKSPACES && daily.rows.some((d) => d.estimated);

  const chartData = useMemo(
    () =>
      daily.rows.map((d) => {
        const row: Record<string, number | string> = { date: d.date };
        for (const s of stackedSeries) {
          if (s.key === OTHER_KEY) {
            // Aggregate the server's Other bucket + any overflow workspaces.
            let sum = d.perWorkspace[OTHER_KEY] ?? 0;
            for (const k of s.overflowKeys) sum += d.perWorkspace[k] ?? 0;
            row[OTHER_KEY] = sum / 100;
          } else {
            row[s.key] = (d.perWorkspace[s.key] ?? 0) / 100;
          }
        }
        if (showEstimate) {
          row[ESTIMATE_KEY] = (d.perWorkspace[ESTIMATE_KEY] ?? 0) / 100;
        }
        return row;
      }),
    [daily.rows, stackedSeries, showEstimate],
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
            <SelectTrigger className="w-full sm:w-[220px]">
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
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <InlineSpinner /> Loading…
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
                  : `Daily spend · ${stackedSeries[0]?.name ?? "Workspace"}`}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {selectedWorkspace === ALL_WORKSPACES
                  ? `Stacked · top ${stackedTopCount} workspaces${stackedHasOther ? " + Other" : ""}`
                  : "Single workspace · filtered view"}
                {" · "}
                <span className="tabular-nums">
                  {formatCurrency(kpis.totalCents)}
                </span>{" "}
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
            <ChartContainer
              config={chartConfig}
              className="min-h-[320px] w-full"
            >
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
                <Legend wrapperStyle={{ paddingTop: 8 }} />
                {stackedSeries.map((s) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    stackId="costs"
                    fill={s.color}
                    name={s.name}
                    radius={[0, 0, 0, 0]}
                    // 1px surface-coloured separator so adjacent stacked
                    // greys (or hues) keep crisp edges.
                    stroke="var(--card)"
                    strokeWidth={1}
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
                    radius={[0, 0, 0, 0]}
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
