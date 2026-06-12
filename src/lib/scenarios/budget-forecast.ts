/**
 * Pure projection engine for the Budget / Cost Forecast Simulation scenario.
 *
 * No imports from `react`, `next`, or `@/lib/db` — only plain math, the data
 * types, and the shared OLS helper. This module runs identically on the server
 * (initial render) and in the browser (every control change), which guarantees
 * the figures shown to the user cannot drift from the ones the unit tests lock.
 *
 * Design note: per-tool decomposition applies to the FORECAST only. Historical
 * (elapsed) periods use the budget's real combined actual (billed + running)
 * from the Budget Report data layer — the schema can't reliably attribute
 * invoices to individual tools, so we don't fabricate per-tool history.
 */

import { olsRegression } from "@/lib/forecast";

export type ToolKind = "metered" | "seat" | "claudeSeats";
export type GrowthModel = "flat" | "linear" | "compound";
export type ClaudeBilling = "monthly" | "yearly";

/**
 * Yearly-commit pricing for Claude seats: $25 → $20 Standard and $125 → $100
 * Premium — exactly 20% off the monthly tier price, expressed as a factor so
 * the toggle keeps tracking the live tier prices if they are ever edited.
 */
export const CLAUDE_YEARLY_FACTOR = 0.8;

/** Effective price multiplier for a Claude seats billing cadence. */
export function claudeBillingFactor(billing?: ClaudeBilling): number {
  return billing === "yearly" ? CLAUDE_YEARLY_FACTOR : 1;
}

/** A tool's current state, assembled in budget-forecast-queries.ts. */
export type ForecastTool = {
  key: string;
  label: string;
  vendor: string;
  kind: ToolKind;
  /** current seat / API-key count (state at the projection anchor). */
  seats0: number;
  /** metered: representative cents per user per period. */
  burn0?: number;
  /** seat: cents per seat per period. */
  price?: number;
  /** claudeSeats: the two tier prices + current Premium share (display default). */
  stdPrice?: number;
  premPrice?: number;
  premShare0?: number;
};

/** Per-tool levers the UI binds to. */
export type ToolParams = {
  include: boolean;
  model: GrowthModel;
  /** linear: seats added per period; compound: % per period. */
  val: number;
  /** metered: burn growth % per period. */
  burnPct?: number;
  /** metered: cap on cents per user per period. */
  burnCap?: number;
  /** claudeSeats: Premium fraction 0..1. */
  premShare?: number;
  /** claudeSeats: billing cadence; undefined ≡ "monthly". */
  billing?: ClaudeBilling;
};

export type ForecastInputs = {
  /** editable modeled ceiling (cents); defaults to the live budget ceiling. */
  ceilingCents: number;
  tools: Record<string, ToolParams>;
};

export type ForecastPeriod = {
  label: string;
  plannedCents: number;
  /** real combined actual for elapsed periods; 0 for remaining. */
  actualCents: number;
  elapsed: boolean;
};

export type ForecastDataset = {
  /** the live budget ceiling (cents); the editable one lives in inputs. */
  liveCeilingCents: number;
  fiscalYear: number;
  periods: ForecastPeriod[];
  /** index of the last elapsed period; -1 if none. Projection starts after it. */
  lastElapsedIndex: number;
  tools: ForecastTool[];
  generatedAt: string;
};

export type ScenarioResult = {
  /** per-period cost per tool; 0 on elapsed periods (history isn't decomposed). */
  perTool: Record<string, number[]>;
  total: number[];
  cumulative: number[];
  spentToDateCents: number;
  yearEndCents: number;
  /** first period index where cumulative exceeds the ceiling; -1 if never. */
  breachIndex: number;
  peakRunRateCents: number;
  topDriverKey: string | null;
};

export type TrendBand = {
  /** cumulative center / bounds per period; null on elapsed periods (actual is known). */
  center: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
};

const DEFAULT_PARAMS: ToolParams = { include: true, model: "flat", val: 0 };

function paramsFor(inputs: ForecastInputs, key: string): ToolParams {
  return inputs.tools[key] ?? DEFAULT_PARAMS;
}

/** Seat / key count at projection offset k (k = periods after the anchor). */
export function seatsAt(
  seats0: number,
  model: GrowthModel,
  val: number,
  k: number,
): number {
  if (model === "linear") return Math.max(0, seats0 + val * k);
  if (model === "compound") {
    return Math.max(0, seats0 * Math.pow(1 + val / 100, k));
  }
  return seats0;
}

/** One tool's projected cost (cents) at offset k under params p. */
export function toolCostAt(
  tool: ForecastTool,
  p: ToolParams,
  k: number,
): number {
  if (tool.kind === "metered") {
    const seats = seatsAt(tool.seats0, p.model, p.val, k);
    const cap = p.burnCap ?? Number.POSITIVE_INFINITY;
    const burn = Math.min(
      cap,
      (tool.burn0 ?? 0) * Math.pow(1 + (p.burnPct ?? 0) / 100, k),
    );
    return Math.round(seats * burn);
  }
  if (tool.kind === "claudeSeats") {
    const seats = seatsAt(tool.seats0, p.model, p.val, k);
    const share = p.premShare ?? tool.premShare0 ?? 0;
    const prem = seats * share;
    const std = seats - prem;
    return Math.round(
      (std * (tool.stdPrice ?? 0) + prem * (tool.premPrice ?? 0)) *
        claudeBillingFactor(p.billing),
    );
  }
  const seats = seatsAt(tool.seats0, p.model, p.val, k);
  return Math.round(seats * (tool.price ?? 0));
}

/** A tool's monthly cost at the projection anchor (k=0), uncapped — for display. */
export function currentMonthlyCost(tool: ForecastTool, p: ToolParams): number {
  if (tool.kind === "metered") {
    return Math.round(tool.seats0 * (tool.burn0 ?? 0));
  }
  // claudeSeats at the anchor is exactly the k=0 projection (no cap involved).
  if (tool.kind === "claudeSeats") return toolCostAt(tool, p, 0);
  return Math.round(tool.seats0 * (tool.price ?? 0));
}

/** Project the full per-period series for a parameter set. */
export function projectForecast(
  ds: ForecastDataset,
  inputs: ForecastInputs,
): ScenarioResult {
  const n = ds.periods.length;
  const elapsed = ds.lastElapsedIndex;
  const perTool: Record<string, number[]> = {};

  for (const tool of ds.tools) {
    const p = paramsFor(inputs, tool.key);
    const series = new Array<number>(n).fill(0);
    if (p.include) {
      for (let i = elapsed + 1; i < n; i++) {
        series[i] = toolCostAt(tool, p, i - elapsed);
      }
    }
    perTool[tool.key] = series;
  }

  const total = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i <= elapsed) {
      total[i] = ds.periods[i].actualCents;
    } else {
      for (const tool of ds.tools) total[i] += perTool[tool.key][i];
    }
  }

  const cumulative: number[] = [];
  let run = 0;
  for (let i = 0; i < n; i++) {
    run += total[i];
    cumulative.push(run);
  }

  const spentToDateCents = elapsed >= 0 ? cumulative[elapsed] : 0;
  const yearEndCents = cumulative[n - 1] ?? 0;

  let breachIndex = -1;
  for (let i = 0; i < n; i++) {
    if (cumulative[i] > inputs.ceilingCents) {
      breachIndex = i;
      break;
    }
  }

  let peakRunRateCents = 0;
  for (let i = elapsed + 1; i < n; i++) {
    if (total[i] > peakRunRateCents) peakRunRateCents = total[i];
  }

  let topDriverKey: string | null = null;
  let max = -1;
  for (const tool of ds.tools) {
    if (!paramsFor(inputs, tool.key).include) continue;
    let s = 0;
    for (let i = elapsed + 1; i < n; i++) s += perTool[tool.key][i];
    if (s > max) {
      max = s;
      topDriverKey = tool.key;
    }
  }

  return {
    perTool,
    total,
    cumulative,
    spentToDateCents,
    yearEndCents,
    breachIndex,
    peakRunRateCents,
    topDriverKey,
  };
}

/**
 * OLS trend band over the remaining periods. Fits forecast.ts's regression on
 * the per-period actual totals, projects it forward, and widens a ±RMSE band
 * with the horizon. Elapsed periods stay null (actual is already known).
 */
export function computeTrendBand(ds: ForecastDataset): TrendBand {
  const n = ds.periods.length;
  const center: (number | null)[] = new Array(n).fill(null);
  const upper: (number | null)[] = new Array(n).fill(null);
  const lower: (number | null)[] = new Array(n).fill(null);

  const elapsed = ds.lastElapsedIndex;
  if (elapsed < 1) return { center, upper, lower }; // need ≥2 points to fit

  const elapsedActuals = ds.periods
    .slice(0, elapsed + 1)
    .map((p) => p.actualCents);
  // Fit only on periods that actually have spend — mirrors buildBudgetForecast's
  // `actual > 0` filter so a not-yet-ingested or genuinely $0 month doesn't drag
  // the trend toward zero. The cumulative anchor still uses every elapsed actual.
  const fit = elapsedActuals.map((y, x) => ({ x, y })).filter((pt) => pt.y > 0);
  if (fit.length < 2) return { center, upper, lower };

  const { slope, intercept } = olsRegression(
    fit.map((pt) => pt.x),
    fit.map((pt) => pt.y),
  );
  const sse = fit.reduce(
    (s, pt) => s + (pt.y - (slope * pt.x + intercept)) ** 2,
    0,
  );
  const rmse = Math.sqrt(sse / fit.length);

  const anchor = elapsedActuals.reduce((s, v) => s + v, 0);
  let cum = anchor;
  let band = 0;
  center[elapsed] = anchor;
  upper[elapsed] = anchor;
  lower[elapsed] = anchor;
  for (let i = elapsed + 1; i < n; i++) {
    cum += Math.max(0, slope * i + intercept);
    band += rmse; // widen linearly with the horizon
    center[i] = Math.round(cum);
    upper[i] = Math.round(cum + band);
    lower[i] = Math.round(Math.max(anchor, cum - band));
  }

  return { center, upper, lower };
}

/* ------------------------- named scenario presets ------------------------- */

/**
 * The H2 2026 migration plan, at three speeds. The strategy in all three:
 * sunset Claude Console API access (compound decline — decays toward, but
 * never hits, zero: a few applications and a few users remain), ramp Claude
 * seats hard at a high Premium share, let GitHub Copilot drift down very
 * slowly or hold flat, and keep Cursor and Microsoft Copilot as-is.
 *
 * The API fade rates are tuned against the live ~42 active keys over the ~7
 * remaining FY2026 periods: −15% ≈ 13–14 keys left, −25% ≈ 5–6 (the central
 * plan — confirmed "a few applications and a few users" target), −50% ≈ 0.3.
 * Per-key burn is held flat (burnPct 0, no cap) — the seat fade is the story.
 */
export type PresetKey = "h2Gradual" | "h2Plan" | "h2Accelerated";

export type ForecastPreset = {
  label: string;
  tag: string;
  tools: Record<string, ToolParams>;
};

export const FORECAST_PRESETS: Record<PresetKey, ForecastPreset> = {
  h2Gradual: {
    label: "H2 Gradual",
    tag: "Soft landing",
    tools: {
      api: { include: true, model: "compound", val: -15, burnPct: 0 },
      claude: { include: true, model: "linear", val: 10, premShare: 0.35 },
      copilot: { include: true, model: "flat", val: 0 },
      cursor: { include: true, model: "flat", val: 0 },
      mscopilot: { include: true, model: "flat", val: 0 },
    },
  },
  h2Plan: {
    label: "H2 Plan",
    tag: "Console sunset",
    tools: {
      api: { include: true, model: "compound", val: -25, burnPct: 0 },
      claude: { include: true, model: "linear", val: 15, premShare: 0.4 },
      copilot: { include: true, model: "linear", val: -1 },
      cursor: { include: true, model: "flat", val: 0 },
      mscopilot: { include: true, model: "flat", val: 0 },
    },
  },
  h2Accelerated: {
    label: "H2 Accelerated",
    tag: "Hard cutover",
    tools: {
      api: { include: true, model: "compound", val: -50, burnPct: 0 },
      claude: { include: true, model: "linear", val: 20, premShare: 0.4 },
      copilot: { include: true, model: "linear", val: -2 },
      cursor: { include: true, model: "flat", val: 0 },
      mscopilot: { include: true, model: "flat", val: 0 },
    },
  },
};

/**
 * Build a full input set from a preset, scoped to the dataset's tools.
 *
 * Billing cadence is orthogonal to the presets (it's a procurement assumption,
 * not a scenario lever) and is threaded in here so the client can keep the
 * user's cadence when switching tiles. It is stamped onto claudeSeats-kind
 * tools only when "yearly" — undefined ≡ monthly, so monthly inputs stay
 * deep-equal to pristine preset inputs.
 */
export function inputsFromPreset(
  ds: ForecastDataset,
  key: PresetKey,
  billing?: ClaudeBilling,
): ForecastInputs {
  const preset = FORECAST_PRESETS[key];
  const tools: Record<string, ToolParams> = {};
  for (const tool of ds.tools) {
    const p = preset.tools[tool.key];
    const params = p ? { ...p } : { ...DEFAULT_PARAMS };
    if (tool.kind === "claudeSeats" && billing === "yearly") {
      params.billing = "yearly";
    }
    tools[tool.key] = params;
  }
  return { ceilingCents: ds.liveCeilingCents, tools };
}

/** Default editable params for the "Custom" plan — seeded from H2 Plan. */
export function defaultInputs(ds: ForecastDataset): ForecastInputs {
  return inputsFromPreset(ds, "h2Plan");
}
