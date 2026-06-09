"use client";

import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn, formatCurrency } from "@/lib/utils";
import { formatAxisUSDk, formatUSD0 } from "@/lib/chart-format";
import {
  computeTrendBand,
  currentMonthlyCost,
  defaultInputs,
  FORECAST_PRESETS,
  inputsFromPreset,
  projectForecast,
  type ForecastDataset,
  type ForecastInputs,
  type ForecastTool,
  type GrowthModel,
  type PresetKey,
  type ScenarioResult,
  type ToolParams,
} from "@/lib/scenarios/budget-forecast";

type ActiveScenario = PresetKey | "custom";

// Greyscale per-tool series tokens (chart-1..5), assigned in dataset tool order
// so the stacked-bar forecast and the per-tool table stay visually consistent.
const TOOL_SWATCHES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

const PRESET_ORDER: PresetKey[] = ["conservative", "expected", "aggressive"];
// Ghost cumulative line tokens for the three presets on the burn-up chart.
const GHOST_COLOR: Record<PresetKey, string> = {
  conservative: "var(--chart-4)",
  expected: "var(--chart-3)",
  aggressive: "var(--chart-2)",
};

const MODEL_LABEL: Record<GrowthModel, string> = {
  flat: "Flat",
  linear: "+N seats/period",
  compound: "+%/period",
};

// Burn-cap slider ceiling (cents/user/period). At the top the cap is treated as
// "No cap" (stored as undefined → engine leaves the metered line uncapped).
const CAP_MAX = 50000;

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

export function BudgetForecastClient({
  dataset,
}: {
  dataset: ForecastDataset;
}) {
  const [inputs, setInputs] = useState<ForecastInputs>(() =>
    defaultInputs(dataset),
  );
  const [active, setActive] = useState<ActiveScenario>("expected");
  // Local string-backed editor for the ceiling so an in-progress empty field
  // doesn't snap to 0 mid-keystroke; the dollars value drives inputs.ceilingCents.
  const [ceilingDollars, setCeilingDollars] = useState(
    String(Math.round(dataset.liveCeilingCents / 100)),
  );

  const plan = useMemo(
    () => projectForecast(dataset, inputs),
    [dataset, inputs],
  );

  // The three named presets, computed once per dataset — drives the scenario
  // tiles, the comparison table, and the ghost cumulative lines.
  // Presets are scored against the *edited* ceiling so the tiles, ghost lines,
  // and comparison rows all compare against the same target the verdict uses.
  const presetInputs = useMemo(() => {
    const out = {} as Record<PresetKey, ForecastInputs>;
    for (const key of PRESET_ORDER)
      out[key] = {
        ...inputsFromPreset(dataset, key),
        ceilingCents: inputs.ceilingCents,
      };
    return out;
  }, [dataset, inputs.ceilingCents]);
  const presetPlans = useMemo(() => {
    const out = {} as Record<PresetKey, ScenarioResult>;
    for (const key of PRESET_ORDER)
      out[key] = projectForecast(dataset, presetInputs[key]);
    return out;
  }, [dataset, presetInputs]);

  const band = useMemo(() => computeTrendBand(dataset), [dataset]);

  const swatchFor = useMemo(() => {
    const map: Record<string, string> = {};
    dataset.tools.forEach((t, i) => {
      map[t.key] = TOOL_SWATCHES[i % TOOL_SWATCHES.length];
    });
    return map;
  }, [dataset.tools]);

  const toolByKey = useMemo(() => {
    const map: Record<string, ForecastTool> = {};
    for (const t of dataset.tools) map[t.key] = t;
    return map;
  }, [dataset.tools]);

  /* ---------------------------- mutation helpers --------------------------- */

  function applyPreset(key: PresetKey) {
    const next = inputsFromPreset(dataset, key);
    setInputs(next);
    setCeilingDollars(String(Math.round(next.ceilingCents / 100)));
    setActive(key);
  }

  function patchTool(key: string, patch: Partial<ToolParams>) {
    setInputs((prev) => ({
      ...prev,
      tools: {
        ...prev.tools,
        [key]: { ...prev.tools[key], ...patch },
      },
    }));
    setActive("custom");
  }

  function setCeiling(raw: string) {
    setCeilingDollars(raw);
    const dollars = raw === "" ? 0 : Math.max(0, Number(raw));
    if (!Number.isNaN(dollars)) {
      setInputs((prev) => ({
        ...prev,
        ceilingCents: Math.round(dollars * 100),
      }));
      setActive("custom");
    }
  }

  function reset() {
    const next = defaultInputs(dataset);
    setInputs(next);
    setCeilingDollars(String(Math.round(next.ceilingCents / 100)));
    setActive("expected");
  }

  /* ------------------------------- derived UI ------------------------------ */

  const ceiling = inputs.ceilingCents;
  const over = plan.yearEndCents - ceiling; // + = overage, − = headroom
  const isOver = over > 0;
  const valueText = isOver ? "text-destructive" : "text-success";
  const periodCount = dataset.periods.length;
  const elapsedCount = dataset.lastElapsedIndex + 1;
  const breachLabel =
    plan.breachIndex >= 0 ? dataset.periods[plan.breachIndex].label : null;
  // A breach during an elapsed period means spend is *already* over the (edited)
  // ceiling — distinct from a projected future breach.
  const breachIsFuture = plan.breachIndex > dataset.lastElapsedIndex;
  const topDriver = plan.topDriverKey ? toolByKey[plan.topDriverKey] : null;
  const lastElapsedLabel =
    dataset.lastElapsedIndex >= 0
      ? dataset.periods[dataset.lastElapsedIndex].label
      : null;
  const lastLabel = dataset.periods[periodCount - 1]?.label ?? "";

  const includedTools = useMemo(
    () => dataset.tools.filter((t) => inputs.tools[t.key]?.include),
    [dataset.tools, inputs.tools],
  );
  const remainingIdx = useMemo(() => {
    const idx: number[] = [];
    for (let i = dataset.lastElapsedIndex + 1; i < periodCount; i++)
      idx.push(i);
    return idx;
  }, [dataset.lastElapsedIndex, periodCount]);

  // Full cumulative planned staircase across the whole fiscal year (the budget's
  // own plan, independent of any scenario).
  const plannedCum = useMemo(() => {
    const out: number[] = [];
    let run = 0;
    for (const p of dataset.periods) {
      run += p.plannedCents;
      out.push(run);
    }
    return out;
  }, [dataset.periods]);
  const plannedRemainingTotal = useMemo(
    () => remainingIdx.reduce((s, i) => s + dataset.periods[i].plannedCents, 0),
    [remainingIdx, dataset.periods],
  );

  /* ------------------------------ chart config ----------------------------- */

  const burnConfig = useMemo<ChartConfig>(() => {
    const cfg: ChartConfig = {
      actual: { label: "Actual to date", color: "var(--chart-1)" },
      plan: {
        label: "Your plan",
        color: isOver ? "var(--destructive)" : "var(--success)",
      },
      planned: { label: "Planned (budget)", color: "var(--muted-foreground)" },
    };
    for (const key of PRESET_ORDER) {
      cfg[key] = {
        label: FORECAST_PRESETS[key].label,
        color: GHOST_COLOR[key],
      };
    }
    return cfg;
  }, [isOver]);

  const burnData = useMemo(() => {
    return dataset.periods.map((p, i) => {
      const row: Record<string, number | string | null> = {
        label: p.label,
        actual: i <= dataset.lastElapsedIndex ? plan.cumulative[i] : null,
        // The "your plan" cumulative covers the anchor + forecast region.
        plan: i >= dataset.lastElapsedIndex ? plan.cumulative[i] : null,
        planned: plannedCum[i] ?? null,
        bandLower: band.lower[i],
        bandSpan:
          band.lower[i] != null && band.upper[i] != null
            ? (band.upper[i] as number) - (band.lower[i] as number)
            : null,
      };
      for (const key of PRESET_ORDER) {
        row[key] =
          i >= dataset.lastElapsedIndex ? presetPlans[key].cumulative[i] : null;
      }
      return row;
    });
  }, [
    dataset.periods,
    dataset.lastElapsedIndex,
    plan,
    band,
    presetPlans,
    plannedCum,
  ]);

  // Stacked monthly bars: elapsed periods collapse to a single "actual" series;
  // forecast periods break out per included tool.
  const stackConfig = useMemo<ChartConfig>(() => {
    const cfg: ChartConfig = {
      // Distinct from the chart-1..5 tool ramp so the legend's "Actual" swatch
      // can't be confused with the first tool's.
      actual: { label: "Actual", color: "var(--muted-foreground)" },
    };
    for (const t of dataset.tools) {
      cfg[t.key] = { label: t.label, color: swatchFor[t.key] };
    }
    return cfg;
  }, [dataset.tools, swatchFor]);

  const stackData = useMemo(() => {
    return dataset.periods.map((p, i) => {
      const elapsed = i <= dataset.lastElapsedIndex;
      const row: Record<string, number | string | null> = {
        label: p.label,
        actual: elapsed ? plan.total[i] : null,
      };
      for (const t of dataset.tools) {
        row[t.key] = elapsed ? null : (plan.perTool[t.key]?.[i] ?? 0);
      }
      return row;
    });
  }, [dataset.periods, dataset.lastElapsedIndex, dataset.tools, plan]);

  /* -------------------------- comparison table rows ------------------------ */

  // Every row is scored against the same (edited) ceiling, so the per-row value
  // lives in the outer `ceiling` const rather than being threaded per row.
  const comparisonRows = useMemo(() => {
    const rows: {
      id: ActiveScenario;
      label: string;
      result: ScenarioResult;
    }[] = PRESET_ORDER.map((key) => ({
      id: key,
      label: FORECAST_PRESETS[key].label,
      result: presetPlans[key],
    }));
    rows.push({ id: "custom", label: "Your plan", result: plan });
    return rows;
  }, [presetPlans, plan]);

  /* ------------------------------ per-tool table --------------------------- */

  const toolForecastTotals = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of includedTools) {
      let sum = 0;
      for (const i of remainingIdx) sum += plan.perTool[t.key]?.[i] ?? 0;
      map[t.key] = sum;
    }
    return map;
  }, [includedTools, remainingIdx, plan.perTool]);

  // The engine zeroes excluded tools' series, so each forecast period's
  // all-tools column total is just plan.total[i], and the forecast grand total
  // is year-end minus spend-to-date — no separate accumulation needed.
  const allToolsForecast = plan.yearEndCents - plan.spentToDateCents;

  return (
    <div className="space-y-6">
      {/* 1 — KPI STRIP */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Live budget ceiling"
          value={formatUSD0(dataset.liveCeilingCents)}
          sub={`FY ${dataset.fiscalYear} · ${periodCount} periods`}
        />
        <Kpi
          label="Spent to date"
          value={formatUSD0(plan.spentToDateCents)}
          sub={
            <>
              <span className="text-ink">
                {pct(plan.spentToDateCents, dataset.liveCeilingCents) ?? 0}%
              </span>{" "}
              of ceiling · {elapsedCount} of {periodCount} elapsed
            </>
          }
        />
        <Kpi
          label="Projected year-end"
          value={
            <span className={valueText}>{formatUSD0(plan.yearEndCents)}</span>
          }
          sub={
            <>
              vs {formatUSD0(ceiling)} ceiling ·{" "}
              <span className="text-ink">
                {pct(plan.yearEndCents, ceiling) ?? 0}%
              </span>
            </>
          }
        />
        <Kpi
          label={isOver ? "Projected overage" : "Projected headroom"}
          value={
            <span className={valueText}>
              {isOver ? "+" : "−"}
              {formatUSD0(Math.abs(over))}
            </span>
          }
          sub={
            plan.breachIndex < 0 ? (
              "stays under all year"
            ) : breachIsFuture ? (
              <span className="text-destructive">breaches {breachLabel}</span>
            ) : (
              <span className="text-destructive">already over ceiling</span>
            )
          }
        />
      </div>

      {/* 2 — SCENARIO TABS */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {PRESET_ORDER.map((key) => {
          const p = presetPlans[key];
          const d = p.yearEndCents - ceiling;
          return (
            <ScenarioTile
              key={key}
              active={active === key}
              tag={FORECAST_PRESETS[key].tag}
              title={FORECAST_PRESETS[key].label}
              cents={p.yearEndCents}
              delta={d}
              onClick={() => applyPreset(key)}
            />
          );
        })}
        <ScenarioTile
          active={active === "custom"}
          tag="Hand-tuned"
          title="Custom"
          cents={plan.yearEndCents}
          delta={over}
          onClick={() => setActive("custom")}
        />
      </div>

      {/* 3 — CONTROLS PANEL */}
      <Card>
        <CardContent className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Assumptions
            </span>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
            >
              <RotateCcw className="size-3" aria-hidden /> Reset to Expected
            </button>
          </div>

          {/* Budget ceiling */}
          <div className="mb-5 max-w-xs">
            <ControlLabel htmlFor="ceiling">Budget ceiling</ControlLabel>
            <div className="mt-2 flex h-10 items-center gap-1.5 rounded-[6px] border border-input bg-card px-3 focus-within:border-ink">
              <span className="font-mono text-sm text-muted-foreground">$</span>
              <input
                id="ceiling"
                type="number"
                min={0}
                step={1000}
                value={ceilingDollars}
                onChange={(e) => setCeiling(e.target.value)}
                className="w-full bg-transparent font-mono text-base tabular-nums text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                / yr
              </span>
            </div>
          </div>

          <div className="space-y-3">
            {dataset.tools.map((tool) => {
              const p = inputs.tools[tool.key];
              if (!p) return null;
              return (
                <ToolControl
                  key={tool.key}
                  tool={tool}
                  params={p}
                  swatch={swatchFor[tool.key]}
                  onChange={(patch) => patchTool(tool.key, patch)}
                />
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* 4 — VERDICT */}
      <div
        className={cn(
          "flex flex-col gap-1 border-l-2 bg-card px-5 py-4",
          isOver ? "border-destructive" : "border-success",
        )}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Forecast verdict
        </p>
        <p className={cn("font-display text-3xl tabular-nums", valueText)}>
          {formatUSD0(plan.yearEndCents)}
          <span className="ml-2 font-mono text-sm text-muted-foreground">
            projected year-end
          </span>
        </p>
        <p className="max-w-3xl text-sm text-muted-foreground">
          This plan lands{" "}
          <span className={valueText}>
            {isOver ? "+" : "−"}
            {formatUSD0(Math.abs(over))}
          </span>{" "}
          {isOver ? "over" : "under"} the {formatUSD0(ceiling)} ceiling
          {plan.breachIndex < 0 ? (
            ", staying within budget all year"
          ) : breachIsFuture ? (
            <>
              {" "}
              and{" "}
              <span className="text-destructive">
                breaches in {breachLabel}
              </span>
            </>
          ) : (
            <>
              {" "}
              and is{" "}
              <span className="text-destructive">already over the ceiling</span>
            </>
          )}
          {topDriver ? (
            <>
              {" "}
              — the largest forecast driver is{" "}
              <span className="text-ink">{topDriver.label}</span>
            </>
          ) : null}
          .
        </p>
      </div>

      {/* 5 — BURN-UP CHART */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Cumulative burn-up
          </p>
          <div
            role="img"
            aria-label={`Cumulative spend burn-up. Your plan projects ${formatUSD0(
              plan.yearEndCents,
            )} at year-end versus a ${formatUSD0(ceiling)} ceiling${
              breachIsFuture && breachLabel
                ? `, breaching in ${breachLabel}`
                : plan.breachIndex >= 0
                  ? ", already over the ceiling"
                  : ", staying under all year"
            }. Full figures are in the tables below.`}
          >
            <ChartContainer config={burnConfig} className="h-[320px] w-full">
              <ComposedChart
                data={burnData}
                margin={{ top: 16, right: 24, left: 0, bottom: 0 }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                />
                <YAxis
                  tickFormatter={(v) => formatAxisUSDk(Number(v))}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                {lastElapsedLabel ? (
                  <ReferenceArea
                    x1={lastElapsedLabel}
                    x2={lastLabel}
                    fill="var(--muted-foreground)"
                    fillOpacity={0.05}
                    ifOverflow="extendDomain"
                  />
                ) : null}
                {/* OLS trend band — stacked invisible base + visible span. */}
                <Area
                  dataKey="bandLower"
                  stackId="band"
                  stroke="none"
                  fill="none"
                  fillOpacity={0}
                  isAnimationActive={false}
                  legendType="none"
                  tooltipType="none"
                  connectNulls
                />
                <Area
                  dataKey="bandSpan"
                  stackId="band"
                  stroke="none"
                  fill="var(--muted-foreground)"
                  fillOpacity={0.1}
                  isAnimationActive={false}
                  legendType="none"
                  tooltipType="none"
                  connectNulls
                />
                <ReferenceLine
                  y={ceiling}
                  stroke="var(--destructive)"
                  strokeDasharray="6 4"
                  label={{
                    value: `Ceiling ${formatUSD0(ceiling)}`,
                    position: "insideTopRight",
                    fontSize: 11,
                    fill: "var(--destructive)",
                  }}
                />
                {PRESET_ORDER.map((key) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={GHOST_COLOR[key]}
                    strokeWidth={1}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
                <Line
                  type="stepAfter"
                  dataKey="planned"
                  stroke="var(--muted-foreground)"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  strokeOpacity={0.5}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="actual"
                  stroke="var(--chart-1)"
                  strokeWidth={2.5}
                  dot={{ r: 2.5 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="plan"
                  stroke={isOver ? "var(--destructive)" : "var(--success)"}
                  strokeWidth={3}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
                {breachIsFuture && breachLabel ? (
                  <ReferenceDot
                    x={breachLabel}
                    y={plan.cumulative[plan.breachIndex]}
                    r={4}
                    fill="var(--destructive)"
                    stroke="var(--background)"
                    strokeWidth={1.5}
                    isFront
                  />
                ) : null}
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelKey="label"
                      valueFormatter={(v) => formatCurrency(Number(v))}
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
              </ComposedChart>
            </ChartContainer>
          </div>
          <p className="font-mono text-[11px] text-faint">
            Shaded band — OLS trend (±RMSE) fit on history, projected forward.
          </p>
        </CardContent>
      </Card>

      {/* 6 — STACKED MONTHLY BARS */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Monthly spend · actual then per-tool forecast
          </p>
          <div
            role="img"
            aria-label="Monthly spend by period: a single Actual bar for elapsed periods, then a per-tool stacked bar for each forecast period. Figures are in the per-tool table below."
          >
            <ChartContainer config={stackConfig} className="h-[200px] w-full">
              <BarChart
                data={stackData}
                margin={{ top: 8, right: 24, left: 0, bottom: 0 }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                />
                <YAxis
                  tickFormatter={(v) => formatAxisUSDk(Number(v))}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelKey="label"
                      valueFormatter={(v) => formatCurrency(Number(v))}
                      showTotal
                      totalLabel="Month total"
                    />
                  }
                />
                <Bar
                  dataKey="actual"
                  stackId="m"
                  fill="var(--muted-foreground)"
                  isAnimationActive={false}
                />
                {dataset.tools.map((t) => (
                  <Bar
                    key={t.key}
                    dataKey={t.key}
                    stackId="m"
                    fill={swatchFor[t.key]}
                    isAnimationActive={false}
                  />
                ))}
                <ChartLegend content={<ChartLegendContent />} />
              </BarChart>
            </ChartContainer>
          </div>
        </CardContent>
      </Card>

      {/* 7 — SCENARIO COMPARISON TABLE */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-left">
                    <HeadLabel>Scenario</HeadLabel>
                  </TableHead>
                  <TableHead className="text-right">
                    <HeadLabel>Year-end</HeadLabel>
                  </TableHead>
                  <TableHead className="text-right">
                    <HeadLabel>Δ vs ceiling</HeadLabel>
                  </TableHead>
                  <TableHead className="text-right">
                    <HeadLabel>% of ceiling</HeadLabel>
                  </TableHead>
                  <TableHead className="text-right">
                    <HeadLabel>Breach</HeadLabel>
                  </TableHead>
                  <TableHead className="text-right">
                    <HeadLabel>Peak run-rate</HeadLabel>
                  </TableHead>
                  <TableHead className="text-right">
                    <HeadLabel>Top driver</HeadLabel>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparisonRows.map((row) => {
                  const d = row.result.yearEndCents - ceiling;
                  const rowOver = d > 0;
                  const rowBreach =
                    row.result.breachIndex >= 0
                      ? dataset.periods[row.result.breachIndex].label
                      : null;
                  const driver = row.result.topDriverKey
                    ? toolByKey[row.result.topDriverKey]?.label
                    : null;
                  const isActiveRow = active === row.id;
                  return (
                    <TableRow
                      key={row.id}
                      className={cn(isActiveRow && "bg-muted/40")}
                    >
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex items-center gap-2 font-medium",
                            isActiveRow ? "text-ink" : "text-muted-foreground",
                          )}
                        >
                          {isActiveRow ? (
                            <span
                              className="inline-block h-3 w-0.5 bg-ink"
                              aria-hidden
                            />
                          ) : null}
                          {row.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm tabular-nums text-ink">
                        {formatUSD0(row.result.yearEndCents)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono text-sm tabular-nums",
                          rowOver ? "text-destructive" : "text-success",
                        )}
                      >
                        {rowOver ? "+" : "−"}
                        {formatUSD0(Math.abs(d))}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm tabular-nums text-muted-foreground">
                        {pct(row.result.yearEndCents, ceiling) ?? 0}%
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {rowBreach ? (
                          <span className="text-destructive">{rowBreach}</span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm tabular-nums text-muted-foreground">
                        {formatUSD0(row.result.peakRunRateCents)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {driver ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* 8 — PER-TOOL DETAIL TABLE */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-left">
                    <HeadLabel>Tool</HeadLabel>
                  </TableHead>
                  {remainingIdx.map((i) => (
                    <TableHead key={i} className="text-right">
                      <HeadLabel>{dataset.periods[i].label}</HeadLabel>
                    </TableHead>
                  ))}
                  <TableHead className="text-right">
                    <HeadLabel>Forecast</HeadLabel>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {includedTools.map((t) => {
                  return (
                    <TableRow key={t.key}>
                      <TableCell>
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="inline-block size-2.5 shrink-0 rounded-[2px]"
                            style={{ backgroundColor: swatchFor[t.key] }}
                            aria-hidden
                          />
                          <span className="font-medium text-ink">
                            {t.label}
                          </span>
                        </span>
                      </TableCell>
                      {remainingIdx.map((i) => {
                        const cents = plan.perTool[t.key]?.[i] ?? 0;
                        return (
                          <TableCell
                            key={i}
                            className="text-right font-mono text-xs tabular-nums text-muted-foreground"
                          >
                            {cents ? formatUSD0(cents) : "·"}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right font-mono text-sm tabular-nums font-medium text-ink">
                        {formatUSD0(toolForecastTotals[t.key])}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-medium">All tools</TableCell>
                  {remainingIdx.map((i) => (
                    <TableCell
                      key={i}
                      className="text-right font-mono text-xs tabular-nums"
                    >
                      {formatUSD0(plan.total[i])}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {formatUSD0(allToolsForecast)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                    Planned (budget)
                  </TableCell>
                  {remainingIdx.map((i) => (
                    <TableCell
                      key={i}
                      className="text-right font-mono text-xs tabular-nums text-muted-foreground"
                    >
                      {formatUSD0(dataset.periods[i].plannedCents)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-mono text-sm tabular-nums text-muted-foreground">
                    {formatUSD0(plannedRemainingTotal)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* 9 — FOOTNOTE */}
      <p className="font-mono text-[11px] text-faint">
        Figures in USD · sourced from the FY {dataset.fiscalYear} budget report
        · history ({elapsedCount} elapsed{" "}
        {elapsedCount === 1 ? "period" : "periods"}) is the budget&apos;s real
        combined actual; the forecast is modelled per tool from the controls
        above · assembled {dataset.generatedAt.slice(0, 16).replace("T", " ")}{" "}
        UTC
      </p>
    </div>
  );
}

/* ---------------------------------- bits --------------------------------- */

function ControlLabel({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
    >
      {children}
    </label>
  );
}

function HeadLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}

function Kpi({
  label,
  value,
  sub,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        <p className="mt-2 font-mono text-2xl tabular-nums tracking-tight text-ink">
          {value}
        </p>
        {sub ? (
          <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ScenarioTile({
  active,
  tag,
  title,
  cents,
  delta,
  onClick,
}: {
  active: boolean;
  tag: string;
  title: string;
  cents: number;
  delta: number;
  onClick: () => void;
}) {
  const over = delta > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "relative flex flex-col items-start rounded-[10px] border bg-card p-4 text-left transition-colors",
        active ? "border-ink" : "border-border hover:border-muted-foreground",
      )}
    >
      {active ? (
        <span
          className="absolute left-0 top-3 bottom-3 w-0.5 bg-ink"
          aria-hidden
        />
      ) : null}
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
        {tag}
      </span>
      <span
        className={cn(
          "mt-0.5 text-sm font-medium",
          active ? "text-ink" : "text-muted-foreground",
        )}
      >
        {title}
      </span>
      <span className="mt-3 font-mono text-2xl tabular-nums tracking-tight text-ink">
        {formatUSD0(cents)}
      </span>
      <span
        className={cn(
          "mt-1 font-mono text-xs tabular-nums",
          over ? "text-destructive" : "text-success",
        )}
      >
        {over ? "+" : "−"}
        {formatUSD0(Math.abs(delta))} vs ceiling
      </span>
    </button>
  );
}

function ToolControl({
  tool,
  params,
  swatch,
  onChange,
}: {
  tool: ForecastTool;
  params: ToolParams;
  swatch: string;
  onChange: (patch: Partial<ToolParams>) => void;
}) {
  const current = currentMonthlyCost(tool, params);
  const dimmed = !params.include;
  return (
    <div
      className={cn(
        "rounded-[8px] border border-border p-4 transition-opacity",
        dimmed && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="inline-block size-2.5 shrink-0 rounded-[2px]"
            style={{ backgroundColor: swatch }}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">
              {tool.label}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-wide text-faint">
              {tool.vendor} · {tool.seats0}{" "}
              {tool.kind === "metered" ? "keys" : "seats"} ·{" "}
              {formatCurrency(current)}/mo
            </p>
          </div>
        </div>
        <label className="flex shrink-0 items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          <Checkbox
            checked={params.include}
            onCheckedChange={(v) => onChange({ include: v === true })}
            aria-label={`Include ${tool.label} in the forecast`}
          />
          Include
        </label>
      </div>

      {params.include ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <ControlLabel htmlFor={`${tool.key}-model`}>
              Growth model
            </ControlLabel>
            <Select
              value={params.model}
              onValueChange={(v) => onChange({ model: v as GrowthModel })}
            >
              <SelectTrigger id={`${tool.key}-model`} className="mt-2 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="flat">{MODEL_LABEL.flat}</SelectItem>
                <SelectItem value="linear">{MODEL_LABEL.linear}</SelectItem>
                <SelectItem value="compound">{MODEL_LABEL.compound}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {params.model !== "flat" ? (
            <NumberField
              id={`${tool.key}-val`}
              label={
                params.model === "linear"
                  ? "Seats / period"
                  : "Growth % / period"
              }
              value={params.val}
              suffix={params.model === "linear" ? "+/−" : "%"}
              onChange={(v) => onChange({ val: v })}
            />
          ) : (
            <div className="flex items-end">
              <p className="font-mono text-[10px] uppercase tracking-wide text-faint">
                Held flat at {tool.seats0}{" "}
                {tool.kind === "metered" ? "keys" : "seats"}
              </p>
            </div>
          )}

          {tool.kind === "metered" ? (
            <>
              <NumberField
                id={`${tool.key}-burn`}
                label="Burn growth % / period"
                value={params.burnPct ?? 0}
                suffix="%"
                onChange={(v) => onChange({ burnPct: v })}
              />
              <RangeField
                id={`${tool.key}-cap`}
                label="Burn cap / user"
                value={params.burnCap ?? CAP_MAX}
                min={0}
                max={CAP_MAX}
                step={1000}
                display={
                  params.burnCap == null || params.burnCap >= CAP_MAX
                    ? "No cap"
                    : formatUSD0(params.burnCap)
                }
                onChange={(v) =>
                  onChange({ burnCap: v >= CAP_MAX ? undefined : v })
                }
              />
            </>
          ) : null}

          {tool.kind === "claudeSeats" ? (
            <RangeField
              id={`${tool.key}-prem`}
              label="Premium share"
              value={Math.round(
                (params.premShare ?? tool.premShare0 ?? 0) * 100,
              )}
              min={0}
              max={100}
              step={1}
              display={`${Math.round(
                (params.premShare ?? tool.premShare0 ?? 0) * 100,
              )}%`}
              onChange={(v) => onChange({ premShare: v / 100 })}
            />
          ) : null}

          {tool.kind === "seat" ? (
            <div className="flex items-end sm:col-span-2 lg:col-span-1">
              <p className="font-mono text-[10px] uppercase tracking-wide text-faint">
                Flat per-seat price · {formatUSD0(tool.price ?? 0)}/seat
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  suffix,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <ControlLabel htmlFor={id}>{label}</ControlLabel>
      <div className="mt-2 flex h-10 items-center gap-1.5 rounded-[6px] border border-input bg-card px-3 focus-within:border-ink">
        <input
          id={id}
          type="number"
          step={1}
          value={value}
          onChange={(e) =>
            onChange(e.target.value === "" ? 0 : Number(e.target.value))
          }
          className="w-full bg-transparent font-mono text-base tabular-nums text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        {suffix ? (
          <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function RangeField({
  id,
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <ControlLabel htmlFor={id}>{label}</ControlLabel>
        <span className="font-mono text-sm tabular-nums text-ink">
          {display}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-3 w-full cursor-pointer"
        style={{ accentColor: "var(--ink)" }}
        aria-label={label}
      />
    </div>
  );
}
