"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, Pencil, RotateCcw, Trash2 } from "lucide-react";
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
  AlertDialog,
  AlertDialogContent,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
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
  CLAUDE_YEARLY_FACTOR,
  claudeBillingFactor,
  computeTrendBand,
  currentMonthlyCost,
  defaultInputs,
  FORECAST_PRESETS,
  inputsFromPreset,
  inputsFromSaved,
  projectForecast,
  type ClaudeBilling,
  type ForecastDataset,
  type ForecastInputs,
  type ForecastTool,
  type GrowthModel,
  type PresetKey,
  type ScenarioResult,
  type ToolParams,
} from "@/lib/scenarios/budget-forecast";
import {
  createForecastScenario,
  deleteForecastScenario,
  updateForecastScenario,
  type SavedForecastScenario,
} from "@/actions/forecast-scenarios";

type ActiveScenario = PresetKey | "custom" | `saved:${number}`;

// Greyscale per-tool series tokens (chart-1..5), assigned in dataset tool order
// so the stacked-bar forecast and the per-tool table stay visually consistent.
const TOOL_SWATCHES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

const PRESET_ORDER: PresetKey[] = ["h2Gradual", "h2Plan", "h2Accelerated"];
// Ghost cumulative line tokens for the three presets on the burn-up chart.
const GHOST_COLOR: Record<PresetKey, string> = {
  h2Gradual: "var(--chart-4)",
  h2Plan: "var(--chart-3)",
  h2Accelerated: "var(--chart-2)",
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
  savedScenarios,
}: {
  dataset: ForecastDataset;
  savedScenarios: SavedForecastScenario[];
}) {
  const router = useRouter();
  const [inputs, setInputs] = useState<ForecastInputs>(() =>
    defaultInputs(dataset),
  );
  const [active, setActive] = useState<ActiveScenario>("h2Plan");
  // Local string-backed editor for the ceiling so an in-progress empty field
  // doesn't snap to 0 mid-keystroke; the dollars value drives inputs.ceilingCents.
  const [ceilingDollars, setCeilingDollars] = useState(
    String(Math.round(dataset.liveCeilingCents / 100)),
  );
  // The saved scenario the user started from this session. Survives control
  // edits (which flip `active` to "custom") so the save dialog can keep
  // offering "Update"; cleared by Reset and by preset-tile clicks (a preset is
  // a new starting point, not a refinement of the loaded scenario).
  const [loadedSavedId, setLoadedSavedId] = useState<number | null>(null);

  // Mutations land via router.refresh(), so client state survives a dataset
  // prop change (the loader's 1h cache can expire mid-session). Re-base the
  // surviving inputs onto the fresh dataset: a tool key the dataset gained
  // would otherwise be projected at defaults by the engine while the controls
  // hide it (`if (!p) return null`).
  const datasetStamp = useRef(dataset.generatedAt);
  useEffect(() => {
    if (datasetStamp.current === dataset.generatedAt) return;
    datasetStamp.current = dataset.generatedAt;
    setInputs((prev) => inputsFromSaved(dataset, prev));
  }, [dataset]);

  const plan = useMemo(
    () => projectForecast(dataset, inputs),
    [dataset, inputs],
  );

  // Claude billing cadence is a procurement assumption, not a scenario lever —
  // it lives on the claudeSeats-kind tool's params (undefined ≡ monthly) and is
  // threaded through preset application *and* scoring so it survives tile
  // switches and every comparison stays like-for-like. A primitive, so the
  // presetInputs memo below only invalidates when the cadence actually flips.
  const claudeSeatsTool = dataset.tools.find((t) => t.kind === "claudeSeats");
  const claudeBilling: ClaudeBilling =
    (claudeSeatsTool && inputs.tools[claudeSeatsTool.key]?.billing) ??
    "monthly";

  // The three named presets, computed once per dataset — drives the scenario
  // tiles, the comparison table, and the ghost cumulative lines.
  // Presets are scored against the *edited* ceiling and the current billing
  // cadence so the tiles, ghost lines, and comparison rows all compare against
  // the same target and price basis the verdict uses.
  const presetInputs = useMemo(() => {
    const out = {} as Record<PresetKey, ForecastInputs>;
    for (const key of PRESET_ORDER)
      out[key] = {
        ...inputsFromPreset(dataset, key, claudeBilling),
        ceilingCents: inputs.ceilingCents,
      };
    return out;
  }, [dataset, inputs.ceilingCents, claudeBilling]);
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

  /* ------------------------ saved scenarios (spec 041) --------------------- */

  // The loaded scenario is derived from the live prop, not cached at load time
  // — if another admin renamed or deleted it, the Update offer follows suit.
  const loadedScenario = useMemo(
    () => savedScenarios.find((s) => s.id === loadedSavedId) ?? null,
    [savedScenarios, loadedSavedId],
  );

  // Each saved row shows its params re-projected against the CURRENT dataset,
  // scored against its own saved ceiling ("what would this plan mean today").
  const savedComputed = useMemo(
    () =>
      savedScenarios.map((scenario) => ({
        scenario,
        result: projectForecast(
          dataset,
          inputsFromSaved(dataset, scenario.params),
        ),
      })),
    [savedScenarios, dataset],
  );

  const [isPending, startTransition] = useTransition();
  // Two-channel feedback (house pattern): one dialog status for errors while
  // an overlay is open (the three dialogs are mutually exclusive, so they
  // share it; each opener clears it), card-header status for success after
  // the overlay closes.
  const cardStatus = useInlineStatus();
  const dialogStatus = useInlineStatus();

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveMode, setSaveMode] = useState<"update" | "new">("new");
  const [saveName, setSaveName] = useState("");
  const [renameTarget, setRenameTarget] =
    useState<SavedForecastScenario | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleteTarget, setDeleteTarget] =
    useState<SavedForecastScenario | null>(null);

  // Focus lands here after a delete — the trigger row is gone by then.
  const savedHeadingRef = useRef<HTMLParagraphElement>(null);

  function loadScenario(s: SavedForecastScenario) {
    setInputs(inputsFromSaved(dataset, s.params));
    // Exact string (no rounding) so a fractional saved ceiling round-trips.
    setCeilingDollars(String(s.params.ceilingCents / 100));
    setActive(`saved:${s.id}`);
    setLoadedSavedId(s.id);
  }

  function openSaveDialog() {
    dialogStatus.clear();
    setSaveMode(loadedScenario ? "update" : "new");
    setSaveName(loadedScenario ? loadedScenario.name : "");
    setSaveOpen(true);
  }

  function submitSave() {
    const name = saveName.trim();
    if (!name) return;
    startTransition(async () => {
      const result =
        saveMode === "update" && loadedScenario
          ? await updateForecastScenario({
              id: loadedScenario.id,
              name,
              params: inputs,
            })
          : await createForecastScenario({ name, params: inputs });
      if (result.success) {
        setSaveOpen(false);
        // The current inputs now match the saved row — mark it loaded/active.
        setLoadedSavedId(result.data.id);
        setActive(`saved:${result.data.id}`);
        cardStatus.ok("SAVED");
        router.refresh();
      } else {
        dialogStatus.error(result.error);
      }
    });
  }

  function openRenameDialog(s: SavedForecastScenario) {
    dialogStatus.clear();
    setRenameTarget(s);
    setRenameName(s.name);
  }

  function submitRename() {
    const target = renameTarget;
    const name = renameName.trim();
    if (!target || !name) return;
    startTransition(async () => {
      // params omitted — rename-only, stored assumptions untouched.
      const result = await updateForecastScenario({ id: target.id, name });
      if (result.success) {
        setRenameTarget(null);
        cardStatus.ok("RENAMED");
        router.refresh();
      } else {
        dialogStatus.error(result.error);
      }
    });
  }

  function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    startTransition(async () => {
      const result = await deleteForecastScenario(target.id);
      if (result.success) {
        setDeleteTarget(null);
        if (loadedSavedId === target.id) {
          // The record is gone but the user's working state stays.
          setLoadedSavedId(null);
          if (active === `saved:${target.id}`) setActive("custom");
        }
        cardStatus.ok("DELETED");
        router.refresh();
        savedHeadingRef.current?.focus();
      } else {
        dialogStatus.error(result.error);
      }
    });
  }

  /* ---------------------------- mutation helpers --------------------------- */

  function applyPreset(key: PresetKey) {
    // The edited ceiling deliberately resets to the live one (the tile answers
    // "this plan against the live budget"), but the billing cadence is kept —
    // switching scenarios shouldn't silently flip how Claude seats are paid.
    const next = inputsFromPreset(dataset, key, claudeBilling);
    setInputs(next);
    setCeilingDollars(String(Math.round(next.ceilingCents / 100)));
    setActive(key);
    // A preset is a new starting point — withdraw the "Update" offer so one
    // click can't overwrite a shared scenario with preset params.
    setLoadedSavedId(null);
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
    setActive("h2Plan");
    setLoadedSavedId(null);
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

      {/* 2b — SAVED SCENARIOS (spec 041) */}
      <Card>
        <CardContent className="p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p
              ref={savedHeadingRef}
              tabIndex={-1}
              className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground outline-none"
            >
              Saved scenarios
            </p>
            <StatusText status={cardStatus.status} />
          </div>
          {savedComputed.length === 0 ? (
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
              [ No saved scenarios — save your current plan ]
            </p>
          ) : (
            <ul className="max-h-72 divide-y divide-border overflow-y-auto">
              {savedComputed.map(({ scenario, result }) => {
                const isLoaded = active === `saved:${scenario.id}`;
                // Scored against the scenario's OWN saved ceiling (a saved row
                // is a self-contained what-if), with the denominator labelled
                // — the rest of the page scores against the edited ceiling.
                const d = result.yearEndCents - scenario.params.ceilingCents;
                const rowOver = d > 0;
                return (
                  <li
                    key={scenario.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5"
                  >
                    <button
                      type="button"
                      onClick={() => loadScenario(scenario)}
                      aria-pressed={isLoaded}
                      className={cn(
                        "relative flex min-w-0 flex-1 items-center py-0.5 pl-2 text-left text-sm font-medium transition-colors",
                        isLoaded
                          ? "text-ink"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {isLoaded ? (
                        <span
                          className="absolute bottom-1 left-0 top-1 w-0.5 bg-ink"
                          aria-hidden
                        />
                      ) : null}
                      <span className="truncate">{scenario.name}</span>
                    </button>
                    <span className="font-mono text-sm tabular-nums text-ink">
                      {formatUSD0(result.yearEndCents)}
                    </span>
                    <span
                      className={cn(
                        "font-mono text-xs tabular-nums",
                        rowOver ? "text-destructive" : "text-success",
                      )}
                    >
                      {rowOver ? "+" : "−"}
                      {formatUSD0(Math.abs(d))} vs saved{" "}
                      {formatUSD0(scenario.params.ceilingCents)}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-faint">
                      {scenario.creatorName ?? "Unknown"} ·{" "}
                      {scenario.updatedAt.slice(0, 10)}
                    </span>
                    <span className="flex shrink-0 items-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Rename scenario ${scenario.name}`}
                        onClick={() => openRenameDialog(scenario)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive"
                        aria-label={`Delete scenario ${scenario.name}`}
                        onClick={() => {
                          dialogStatus.clear();
                          setDeleteTarget(scenario);
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 3 — CONTROLS PANEL */}
      <Card>
        <CardContent className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Assumptions
            </span>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={openSaveDialog}
                className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
              >
                <Bookmark className="size-3" aria-hidden /> Save scenario
              </button>
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
              >
                <RotateCcw className="size-3" aria-hidden /> Reset to H2 Plan
              </button>
            </div>
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
                  // A loaded saved scenario IS the "Your plan" row (the chart
                  // line and these figures are its numbers), so saved:* keeps
                  // the table's one-active-row invariant via the custom row.
                  const isActiveRow =
                    active === row.id ||
                    (row.id === "custom" && active.startsWith("saved:"));
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
        above
        {claudeBilling === "yearly"
          ? ` · Claude seats priced at the yearly-billing rate (${Math.round(
              (1 - CLAUDE_YEARLY_FACTOR) * 100,
            )}% off the monthly tier prices)`
          : ""}{" "}
        · assembled {dataset.generatedAt.slice(0, 16).replace("T", " ")} UTC
      </p>

      {/* 10 — SAVE / RENAME / DELETE DIALOGS (spec 041) */}
      <Dialog
        open={saveOpen}
        onOpenChange={(open) => {
          if (!isPending) setSaveOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save scenario</DialogTitle>
            <DialogDescription>
              Persist the current assumption set for the FY {dataset.fiscalYear}{" "}
              budget — shared with all admins.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {loadedScenario ? (
              <div>
                <ControlLabel>Mode</ControlLabel>
                <div
                  role="group"
                  aria-label="Save mode"
                  className="mt-2 inline-flex w-full overflow-hidden rounded-[6px] border border-input"
                >
                  <ToggleButton
                    active={saveMode === "update"}
                    onClick={() => {
                      if (saveMode !== "update") {
                        setSaveMode("update");
                        setSaveName(loadedScenario.name);
                      }
                    }}
                  >
                    <span className="block truncate">
                      Update &ldquo;{loadedScenario.name}&rdquo;
                    </span>
                  </ToggleButton>
                  <ToggleButton
                    active={saveMode === "new"}
                    onClick={() => saveMode !== "new" && setSaveMode("new")}
                  >
                    Save as new
                  </ToggleButton>
                </div>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="scenario-name">Name</Label>
              <Input
                id="scenario-name"
                placeholder="e.g., Console sunset + yearly commit"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                maxLength={60}
              />
            </div>
            {/* Echo exactly what will be saved — a cleared ceiling field or a
                forgotten yearly toggle is visible before committing. */}
            <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              Ceiling {formatUSD0(inputs.ceilingCents)} · Claude billing{" "}
              {claudeBilling} · {includedTools.length} of {dataset.tools.length}{" "}
              tools included
            </p>
          </div>
          <DialogFooter className="items-center">
            <StatusText status={dialogStatus.status} className="mr-auto" />
            <Button
              variant="outline"
              onClick={() => setSaveOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={submitSave}
              disabled={
                isPending || !saveName.trim() || ceilingDollars.trim() === ""
              }
            >
              {isPending
                ? "Saving..."
                : saveMode === "update" && loadedScenario
                  ? "Update"
                  : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isPending) setRenameTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Rename scenario &ldquo;{renameTarget?.name}&rdquo;
            </DialogTitle>
            <DialogDescription>
              Stored assumptions stay untouched — only the name changes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="scenario-rename">Name</Label>
            <Input
              id="scenario-rename"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              maxLength={60}
            />
          </div>
          <DialogFooter className="items-center">
            <StatusText status={dialogStatus.status} className="mr-auto" />
            <Button
              variant="outline"
              onClick={() => setRenameTarget(null)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={submitRename}
              disabled={isPending || !renameName.trim()}
            >
              {isPending ? "Saving..." : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isPending) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete scenario &ldquo;{deleteTarget?.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Saved by {deleteTarget?.creatorName ?? "Unknown"} and shared with
              all admins. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="items-center">
            <StatusText status={dialogStatus.status} className="mr-auto" />
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={isPending}
            >
              {isPending ? "Deleting..." : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
            <>
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
              <BillingToggle
                tool={tool}
                billing={params.billing ?? "monthly"}
                onChange={(billing) =>
                  // undefined ≡ monthly — keep monthly params normalized so
                  // they stay deep-equal to pristine preset inputs.
                  onChange({
                    billing: billing === "yearly" ? "yearly" : undefined,
                  })
                }
              />
            </>
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

/**
 * Monthly / Yearly billing cadence for the Claude seats line. The effective
 * per-seat prices under the selected cadence render as the caption so the
 * annual-commit discount is visible without leaving the row.
 */
function BillingToggle({
  tool,
  billing,
  onChange,
}: {
  tool: ForecastTool;
  billing: ClaudeBilling;
  onChange: (billing: ClaudeBilling) => void;
}) {
  const factor = claudeBillingFactor(billing);
  return (
    <div>
      <ControlLabel>Billing</ControlLabel>
      <div
        role="group"
        aria-label={`Billing cadence for ${tool.label}`}
        className="mt-2 inline-flex w-full overflow-hidden rounded-[6px] border border-input"
      >
        <ToggleButton
          active={billing === "monthly"}
          // No-op guard: clicking the active cadence shouldn't mutate state
          // (patchTool would needlessly mark the plan Custom).
          onClick={() => billing !== "monthly" && onChange("monthly")}
        >
          Monthly
        </ToggleButton>
        <ToggleButton
          active={billing === "yearly"}
          onClick={() => billing !== "yearly" && onChange("yearly")}
        >
          Yearly
        </ToggleButton>
      </div>
      <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wide text-faint">
        {/* formatUSD0 takes integer cents — round in case a discounted tier
            price ever lands on fractional cents. */}
        {formatUSD0(Math.round((tool.stdPrice ?? 0) * factor))} std ·{" "}
        {formatUSD0(Math.round((tool.premPrice ?? 0) * factor))} prem / seat /
        mo
      </p>
    </div>
  );
}

// Same segmented-toggle pattern as 035's population toggle (page-local there,
// so replicated rather than cross-imported from another route).
function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex-1 px-2 py-2 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors",
        active
          ? "bg-ink text-background"
          : "bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
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
