import { describe, it, expect } from "vitest";
import {
  seatsAt,
  toolCostAt,
  currentMonthlyCost,
  projectForecast,
  computeTrendBand,
  inputsFromPreset,
  inputsFromSaved,
  defaultInputs,
  FORECAST_PRESETS,
  type ForecastDataset,
  type ForecastTool,
  type ForecastInputs,
  type ToolParams,
} from "@/lib/scenarios/budget-forecast";

/**
 * Deterministic fixture for the Budget / Cost Forecast engine.
 *
 * 6 monthly periods, lastElapsedIndex = 2 → indices 0,1,2 are elapsed (real
 * actuals) and 3,4,5 are remaining (projected). Projection offset for a
 * remaining period i is k = i - lastElapsedIndex, so i=3→k=1, i=4→k=2, i=5→k=3.
 *
 * Elapsed actuals (cents): [50000, 60000, 70000] → spentToDate = 180000.
 *
 * Tools:
 *   api     (metered):     seats0=10, burn0=1000
 *   copilot (seat):        seats0=20, price=1900
 *   claude  (claudeSeats): seats0=8,  stdPrice=2000, premPrice=10000, premShare0=0.25
 *
 * All anchor numbers below are computed by hand in the test so they are real
 * regression anchors, not restatements of the implementation.
 */

const API: ForecastTool = {
  key: "api",
  label: "Anthropic API",
  vendor: "Anthropic",
  kind: "metered",
  seats0: 10,
  burn0: 1000,
};

const COPILOT: ForecastTool = {
  key: "copilot",
  label: "GitHub Copilot",
  vendor: "GitHub",
  kind: "seat",
  seats0: 20,
  price: 1900,
};

const CLAUDE: ForecastTool = {
  key: "claude",
  label: "Claude (seats)",
  vendor: "Anthropic",
  kind: "claudeSeats",
  seats0: 8,
  stdPrice: 2000,
  premPrice: 10000,
  premShare0: 0.25,
};

function makeDataset(
  overrides: Partial<ForecastDataset> = {},
): ForecastDataset {
  const actuals = [50000, 60000, 70000];
  const periods = Array.from({ length: 6 }, (_, i) => ({
    label: `P${i + 1}`,
    plannedCents: 80000,
    actualCents: i <= 2 ? actuals[i] : 0,
    elapsed: i <= 2,
  }));
  return {
    liveCeilingCents: 500000,
    fiscalYear: 2026,
    periods,
    lastElapsedIndex: 2,
    tools: [API, COPILOT, CLAUDE],
    generatedAt: "2026-06-09T00:00:00.000Z",
    ...overrides,
  };
}

/** Flat, no-growth params that make projectForecast totals exact integers. */
const FLAT_INPUTS: ForecastInputs = {
  ceilingCents: 500000,
  tools: {
    // metered: round(10 * 1000) = 10000 every remaining period.
    api: { include: true, model: "flat", val: 0, burnPct: 0 },
    // seat: round(20 * 1900) = 38000 every remaining period.
    copilot: { include: true, model: "flat", val: 0 },
    // claudeSeats: seats=8, prem=8*0.25=2, std=6 → 6*2000 + 2*10000 = 32000.
    claude: { include: true, model: "flat", val: 0, premShare: 0.25 },
  },
};
// Per remaining period: 10000 + 38000 + 32000 = 80000.

describe("seatsAt", () => {
  it("flat ignores val and k, returning seats0", () => {
    expect(seatsAt(10, "flat", 5, 0)).toBe(10);
    expect(seatsAt(10, "flat", 5, 3)).toBe(10);
  });

  it("linear adds val per period: seats0 + val*k", () => {
    expect(seatsAt(10, "linear", 4, 0)).toBe(10);
    expect(seatsAt(10, "linear", 4, 3)).toBe(22); // 10 + 4*3
    // negative growth clamps at 0
    expect(seatsAt(10, "linear", -4, 3)).toBe(0); // 10 - 12 → clamp 0
  });

  it("compound grows by val% per period: seats0*(1+val/100)^k", () => {
    expect(seatsAt(10, "compound", 50, 2)).toBeCloseTo(22.5, 6); // 10*1.5^2
    expect(seatsAt(10, "compound", -2, 3)).toBeCloseTo(9.41192, 6); // 10*0.98^3
    expect(seatsAt(10, "compound", 0, 5)).toBe(10);
  });
});

describe("toolCostAt", () => {
  const flat: ToolParams = { include: true, model: "flat", val: 0 };

  it("metered = round(seats * burn) at the anchor (k=0)", () => {
    // seats=10, burn=1000 → 10000
    expect(toolCostAt(API, flat, 0)).toBe(10000);
  });

  it("metered compounds burn by burnPct (no cap)", () => {
    const p: ToolParams = { include: true, model: "flat", val: 0, burnPct: 10 };
    // k=2: burn = 1000 * 1.1^2 = 1210 → 10 * 1210 = 12100
    expect(toolCostAt(API, p, 2)).toBe(12100);
  });

  it("metered clamps burn at burnCap (boundary)", () => {
    const p: ToolParams = {
      include: true,
      model: "flat",
      val: 0,
      burnPct: 100,
      burnCap: 1500,
    };
    // k=0: burn = min(1500, 1000*2^0=1000) = 1000 → still below cap → 10000
    expect(toolCostAt(API, p, 0)).toBe(10000);
    // k=1: burn = min(1500, 1000*2^1=2000) = 1500 (cap clamps) → 10*1500 = 15000
    expect(toolCostAt(API, p, 1)).toBe(15000);
  });

  it("seat = round(seats * price), seats follow the growth model", () => {
    const p: ToolParams = { include: true, model: "linear", val: 2 };
    // k=3: seats = 20 + 2*3 = 26 → 26 * 1900 = 49400
    expect(toolCostAt(COPILOT, p, 3)).toBe(49400);
    // flat at any k: 20 * 1900 = 38000
    expect(toolCostAt(COPILOT, flat, 3)).toBe(38000);
  });

  it("claudeSeats falls back to premShare0 when no override", () => {
    // seats=8, prem=8*0.25=2, std=6 → 6*2000 + 2*10000 = 32000
    expect(toolCostAt(CLAUDE, flat, 0)).toBe(32000);
  });

  it("claudeSeats honours a premShare override over premShare0", () => {
    const p: ToolParams = {
      include: true,
      model: "flat",
      val: 0,
      premShare: 0.5,
    };
    // seats=8, prem=4, std=4 → 4*2000 + 4*10000 = 48000
    expect(toolCostAt(CLAUDE, p, 0)).toBe(48000);
  });

  it("claudeSeats applies the yearly-billing factor (20% off)", () => {
    const p: ToolParams = {
      include: true,
      model: "flat",
      val: 0,
      premShare: 0.25,
      billing: "yearly",
    };
    // monthly 32000 × 0.8 = 25600
    expect(toolCostAt(CLAUDE, p, 0)).toBe(25600);
  });

  it("claudeSeats billing 'monthly' and undefined are equivalent", () => {
    const explicit: ToolParams = {
      include: true,
      model: "flat",
      val: 0,
      premShare: 0.25,
      billing: "monthly",
    };
    expect(toolCostAt(CLAUDE, explicit, 0)).toBe(toolCostAt(CLAUDE, flat, 0));
  });

  it("yearly factor is applied inside the rounding, not after it", () => {
    // stdPrice 2001 makes the discounted sum fractional:
    // 6×2001×0.8 + 2×10000×0.8 = 25604.8 → round once → 25605.
    // A round-then-discount implementation would return 25604.8.
    const oddPriced: ForecastTool = { ...CLAUDE, stdPrice: 2001 };
    const p: ToolParams = {
      include: true,
      model: "flat",
      val: 0,
      premShare: 0.25,
      billing: "yearly",
    };
    expect(toolCostAt(oddPriced, p, 0)).toBe(25605);
  });

  it("billing has no effect on seat or metered tools", () => {
    const p: ToolParams = {
      include: true,
      model: "flat",
      val: 0,
      billing: "yearly",
    };
    expect(toolCostAt(COPILOT, p, 2)).toBe(38000); // 20 × 1900, undiscounted
    expect(toolCostAt(API, p, 0)).toBe(10000); // 10 × 1000, undiscounted
  });
});

describe("currentMonthlyCost (k=0 display, uncapped)", () => {
  it("metered ignores burnPct/cap and uses seats0*burn0", () => {
    const p: ToolParams = {
      include: true,
      model: "flat",
      val: 0,
      burnPct: 100,
      burnCap: 1,
    };
    // cap/burnPct are display-irrelevant here: 10 * 1000 = 10000
    expect(currentMonthlyCost(API, p)).toBe(10000);
  });

  it("claudeSeats mixes std/prem at the current share", () => {
    const p: ToolParams = { include: true, model: "flat", val: 0 };
    expect(currentMonthlyCost(CLAUDE, p)).toBe(32000); // premShare0=0.25
    expect(currentMonthlyCost(CLAUDE, { ...p, premShare: 0.5 })).toBe(48000);
  });

  it("claudeSeats reflects the yearly-billing factor", () => {
    const p: ToolParams = {
      include: true,
      model: "flat",
      val: 0,
      billing: "yearly",
    };
    expect(currentMonthlyCost(CLAUDE, p)).toBe(25600); // 32000 × 0.8
    expect(currentMonthlyCost(CLAUDE, { ...p, premShare: 0.5 })).toBe(38400); // 48000 × 0.8
  });

  it("seat = seats0 * price", () => {
    const p: ToolParams = { include: true, model: "flat", val: 0 };
    expect(currentMonthlyCost(COPILOT, p)).toBe(38000); // 20 * 1900
  });
});

describe("projectForecast", () => {
  const ds = makeDataset();

  it("uses real actuals on elapsed periods, ignoring include toggles", () => {
    const r = projectForecast(ds, FLAT_INPUTS);
    // elapsed totals are the dataset actuals, untouched by per-tool math
    expect(r.total.slice(0, 3)).toEqual([50000, 60000, 70000]);

    // even with everything excluded, elapsed history is unchanged
    const excluded: ForecastInputs = {
      ceilingCents: 500000,
      tools: {
        api: { include: false, model: "flat", val: 0 },
        copilot: { include: false, model: "flat", val: 0 },
        claude: { include: false, model: "flat", val: 0 },
      },
    };
    const r2 = projectForecast(ds, excluded);
    expect(r2.total.slice(0, 3)).toEqual([50000, 60000, 70000]);
    // remaining periods drop to 0 with nothing included
    expect(r2.total.slice(3)).toEqual([0, 0, 0]);
  });

  it("remaining totals are the sum of included tools' toolCostAt", () => {
    const r = projectForecast(ds, FLAT_INPUTS);
    // each remaining period: 10000 (api) + 38000 (copilot) + 32000 (claude)
    expect(r.total.slice(3)).toEqual([80000, 80000, 80000]);
    // per-tool series are 0 on elapsed periods, flat on remaining
    expect(r.perTool.api).toEqual([0, 0, 0, 10000, 10000, 10000]);
    expect(r.perTool.copilot).toEqual([0, 0, 0, 38000, 38000, 38000]);
    expect(r.perTool.claude).toEqual([0, 0, 0, 32000, 32000, 32000]);
  });

  it("cumulative is the running sum of total", () => {
    const r = projectForecast(ds, FLAT_INPUTS);
    // 50000, +60000, +70000, +80000, +80000, +80000
    expect(r.cumulative).toEqual([
      50000, 110000, 180000, 260000, 340000, 420000,
    ]);
  });

  it("spentToDateCents = cumulative at lastElapsedIndex; yearEnd = final cumulative", () => {
    const r = projectForecast(ds, FLAT_INPUTS);
    expect(r.spentToDateCents).toBe(180000); // cumulative[2]
    expect(r.yearEndCents).toBe(420000); // cumulative[5]
  });

  it("peakRunRateCents is the max remaining-period total", () => {
    const r = projectForecast(ds, FLAT_INPUTS);
    expect(r.peakRunRateCents).toBe(80000);
  });

  it("breachIndex is the first period where cumulative exceeds the ceiling", () => {
    // ceiling 300000: cumulative crosses at index 4 (340000 > 300000; 260000 ≤ 300000)
    const r = projectForecast(ds, { ...FLAT_INPUTS, ceilingCents: 300000 });
    expect(r.breachIndex).toBe(4);
  });

  it("breachIndex is -1 when the ceiling is never exceeded", () => {
    // ceiling 500000 > final cumulative 420000 → never breached
    const r = projectForecast(ds, { ...FLAT_INPUTS, ceilingCents: 500000 });
    expect(r.breachIndex).toBe(-1);
  });

  it("topDriverKey is the largest forecast contributor", () => {
    const r = projectForecast(ds, FLAT_INPUTS);
    // remaining sums: api 30000, copilot 114000, claude 96000 → copilot wins
    expect(r.topDriverKey).toBe("copilot");
  });

  it("excluding a tool zeroes its series and drops it from totals/topDriver", () => {
    const noCopilot: ForecastInputs = {
      ceilingCents: 500000,
      tools: {
        api: { include: true, model: "flat", val: 0, burnPct: 0 },
        copilot: { include: false, model: "flat", val: 0 },
        claude: { include: true, model: "flat", val: 0, premShare: 0.25 },
      },
    };
    const r = projectForecast(ds, noCopilot);
    expect(r.perTool.copilot).toEqual([0, 0, 0, 0, 0, 0]);
    // remaining total = api 10000 + claude 32000 = 42000
    expect(r.total.slice(3)).toEqual([42000, 42000, 42000]);
    // claude (96000) now beats api (30000) as top driver
    expect(r.topDriverKey).toBe("claude");
  });
});

describe("computeTrendBand", () => {
  it("returns nulls on elapsed periods and numbers on remaining, with upper >= center >= lower", () => {
    // actuals [50000, 60000, 70000]: perfect line slope=10000, intercept=50000,
    // so RMSE = 0 and the band collapses onto the center.
    const ds = makeDataset();
    const band = computeTrendBand(ds);

    // indices 0..1 are null (need the anchor at lastElapsedIndex onward)
    expect(band.center[0]).toBeNull();
    expect(band.center[1]).toBeNull();
    expect(band.upper[0]).toBeNull();
    expect(band.lower[1]).toBeNull();

    // index 2 (lastElapsedIndex) is the cumulative anchor = 50000+60000+70000
    expect(band.center[2]).toBe(180000);
    expect(band.upper[2]).toBe(180000);
    expect(band.lower[2]).toBe(180000);

    // remaining periods are numbers; cumulative grows by slope*i+intercept.
    // i=3: +(10000*3+50000)=80000 → 260000; i=4: +90000 → 350000; i=5: +100000 → 450000.
    expect(band.center[3]).toBe(260000);
    expect(band.center[4]).toBe(350000);
    expect(band.center[5]).toBe(450000);

    for (let i = 2; i < 6; i++) {
      const c = band.center[i] as number;
      const u = band.upper[i] as number;
      const l = band.lower[i] as number;
      expect(u).toBeGreaterThanOrEqual(c);
      expect(c).toBeGreaterThanOrEqual(l);
    }
  });

  it("widens the band with horizon when there is residual error", () => {
    // Non-collinear actuals → RMSE > 0, so upper > center > lower on remaining.
    const ds = makeDataset({
      periods: [
        { label: "P1", plannedCents: 0, actualCents: 40000, elapsed: true },
        { label: "P2", plannedCents: 0, actualCents: 90000, elapsed: true },
        { label: "P3", plannedCents: 0, actualCents: 70000, elapsed: true },
        { label: "P4", plannedCents: 0, actualCents: 0, elapsed: false },
        { label: "P5", plannedCents: 0, actualCents: 0, elapsed: false },
        { label: "P6", plannedCents: 0, actualCents: 0, elapsed: false },
      ],
    });
    const band = computeTrendBand(ds);
    for (let i = 3; i < 6; i++) {
      const c = band.center[i] as number;
      const u = band.upper[i] as number;
      const l = band.lower[i] as number;
      expect(u).toBeGreaterThan(c);
      expect(c).toBeGreaterThan(l);
    }
    // band widens monotonically with horizon
    const w3 = (band.upper[3] as number) - (band.center[3] as number);
    const w5 = (band.upper[5] as number) - (band.center[5] as number);
    expect(w5).toBeGreaterThan(w3);
  });

  it("returns all-nulls when lastElapsedIndex < 1 (need >=2 points to fit)", () => {
    const ds = makeDataset({
      lastElapsedIndex: 0,
      periods: makeDataset().periods.map((p, i) => ({
        ...p,
        elapsed: i === 0,
      })),
    });
    const band = computeTrendBand(ds);
    expect(band.center.every((v) => v === null)).toBe(true);
    expect(band.upper.every((v) => v === null)).toBe(true);
    expect(band.lower.every((v) => v === null)).toBe(true);
  });

  it("excludes zero-actual elapsed periods from the OLS fit (mirrors buildBudgetForecast)", () => {
    // First elapsed period has no spend (e.g. ingestion lag). The fit must ignore
    // it and use only the two positive months → slope 20000, intercept 40000.
    const ds = makeDataset({
      periods: [
        { label: "P1", plannedCents: 0, actualCents: 0, elapsed: true },
        { label: "P2", plannedCents: 0, actualCents: 60000, elapsed: true },
        { label: "P3", plannedCents: 0, actualCents: 80000, elapsed: true },
        { label: "P4", plannedCents: 0, actualCents: 0, elapsed: false },
        { label: "P5", plannedCents: 0, actualCents: 0, elapsed: false },
        { label: "P6", plannedCents: 0, actualCents: 0, elapsed: false },
      ],
    });
    const band = computeTrendBand(ds);
    // anchor = 0 + 60000 + 80000 = 140000 at lastElapsedIndex (2).
    expect(band.center[2]).toBe(140000);
    // fit on (1,60000),(2,80000) → i=3 adds 20000*3+40000 = 100000.
    // (If the zero month were included in the fit this would be ~266667.)
    expect(band.center[3]).toBe(240000);
  });

  it("returns all-nulls when fewer than 2 elapsed periods have spend", () => {
    const ds = makeDataset({
      periods: makeDataset().periods.map((p, i) => ({
        ...p,
        actualCents: i === 2 ? 70000 : 0, // only one positive elapsed period
      })),
    });
    const band = computeTrendBand(ds);
    expect(band.center.every((v) => v === null)).toBe(true);
  });
});

describe("inputsFromPreset / defaultInputs", () => {
  const ds = makeDataset();

  it("ceilingCents tracks the dataset's live ceiling", () => {
    for (const key of ["h2Gradual", "h2Plan", "h2Accelerated"] as const) {
      expect(inputsFromPreset(ds, key).ceilingCents).toBe(ds.liveCeilingCents);
    }
    expect(defaultInputs(ds).ceilingCents).toBe(ds.liveCeilingCents);
  });

  it("provides params for every dataset tool", () => {
    const inputs = inputsFromPreset(ds, "h2Plan");
    for (const tool of ds.tools) {
      expect(inputs.tools[tool.key]).toBeDefined();
    }
    // a dataset tool not named in a preset still gets DEFAULT_PARAMS
    const dsExtra = makeDataset({
      tools: [...ds.tools, { ...COPILOT, key: "mystery" }],
    });
    const extra = inputsFromPreset(dsExtra, "h2Gradual");
    expect(extra.tools.mystery).toEqual({
      include: true,
      model: "flat",
      val: 0,
    });
  });

  it("defaultInputs is seeded from the H2 Plan preset", () => {
    expect(defaultInputs(ds)).toEqual(inputsFromPreset(ds, "h2Plan"));
  });

  it("the three presets are strictly ascending in yearEndCents", () => {
    const gradual = projectForecast(
      ds,
      inputsFromPreset(ds, "h2Gradual"),
    ).yearEndCents;
    const plan = projectForecast(
      ds,
      inputsFromPreset(ds, "h2Plan"),
    ).yearEndCents;
    const accelerated = projectForecast(
      ds,
      inputsFromPreset(ds, "h2Accelerated"),
    ).yearEndCents;

    // Hand-computed anchors on this fixture (spentToDate 180000 + remaining):
    //   h2Gradual:     api −15%: 8500+7225+6141=21866 · claude (8+10k seats ×
    //                  4800 blended @35%) 86400+134400+182400=403200 · copilot
    //                  flat 38000×3=114000 → 180000+539066 = 719066
    //   h2Plan:        api −25%: 7500+5625+4219=17344 · claude (8+15k × 5200
    //                  @40%) 119600+197600+275600=592800 · copilot −1/period
    //                  36100+34200+32300=102600 → 180000+712744 = 892744
    //   h2Accelerated: api −50%: 5000+2500+1250=8750 · claude (8+20k × 5200
    //                  @40%) 145600+249600+353600=748800 · copilot −2/period
    //                  34200+30400+26600=91200 → 180000+848750 = 1028750
    expect(gradual).toBe(719066);
    expect(plan).toBe(892744);
    expect(accelerated).toBe(1028750);

    expect(gradual).toBeLessThan(plan);
    expect(plan).toBeLessThan(accelerated);
  });

  it("FORECAST_PRESETS exposes the three H2 scenarios", () => {
    expect(Object.keys(FORECAST_PRESETS).sort()).toEqual([
      "h2Accelerated",
      "h2Gradual",
      "h2Plan",
    ]);
    expect(FORECAST_PRESETS.h2Gradual.label).toBe("H2 Gradual");
    expect(FORECAST_PRESETS.h2Plan.label).toBe("H2 Plan");
    expect(FORECAST_PRESETS.h2Accelerated.label).toBe("H2 Accelerated");
  });

  it("stamps yearly billing onto claudeSeats tools only", () => {
    const inputs = inputsFromPreset(ds, "h2Plan", "yearly");
    expect(inputs.tools.claude.billing).toBe("yearly");
    expect(inputs.tools.api.billing).toBeUndefined();
    expect(inputs.tools.copilot.billing).toBeUndefined();
  });

  it("stamps nothing when billing is monthly or omitted", () => {
    expect(inputsFromPreset(ds, "h2Plan", "monthly")).toEqual(
      inputsFromPreset(ds, "h2Plan"),
    );
    expect(inputsFromPreset(ds, "h2Plan").tools.claude.billing).toBeUndefined();
  });

  it("yearly billing discounts exactly the claude line (h2Plan anchor)", () => {
    const monthly = projectForecast(ds, inputsFromPreset(ds, "h2Plan"));
    const yearly = projectForecast(
      ds,
      inputsFromPreset(ds, "h2Plan", "yearly"),
    );
    // api / copilot untouched; claude series × 0.8 exactly.
    expect(yearly.perTool.api).toEqual(monthly.perTool.api);
    expect(yearly.perTool.copilot).toEqual(monthly.perTool.copilot);
    expect(yearly.perTool.claude).toEqual([0, 0, 0, 95680, 158080, 220480]);
    // 180000 + 17344 + 474240 + 102600
    expect(yearly.yearEndCents).toBe(774184);
  });
});

describe("inputsFromSaved (spec 041)", () => {
  const ds = makeDataset();

  /** A representative saved parameter set: edited ceiling, tuned levers. */
  const SAVED: ForecastInputs = {
    ceilingCents: 260000,
    tools: {
      api: {
        include: true,
        model: "compound",
        val: -25,
        burnPct: 5,
        burnCap: 800,
      },
      copilot: { include: false, model: "flat", val: 0 },
      claude: {
        include: true,
        model: "linear",
        val: 15,
        premShare: 0.4,
        billing: "yearly",
      },
    },
  };

  it("carries the saved ceiling, including the 0 boundary", () => {
    expect(inputsFromSaved(ds, SAVED).ceilingCents).toBe(260000);
    expect(
      inputsFromSaved(ds, { ...SAVED, ceilingCents: 0 }).ceilingCents,
    ).toBe(0);
  });

  it("copies params per tool, preserving every lever", () => {
    const rebased = inputsFromSaved(ds, SAVED);
    expect(rebased.tools.api).toEqual(SAVED.tools.api);
    expect(rebased.tools.copilot).toEqual(SAVED.tools.copilot);
    expect(rebased.tools.claude).toEqual(SAVED.tools.claude);
  });

  it("preserves the yearly billing cadence through the rebase", () => {
    // This copy is what makes "load restores the cadence" true — the client
    // derives the toggle from the claudeSeats tool's params.
    expect(inputsFromSaved(ds, SAVED).tools.claude.billing).toBe("yearly");
  });

  it("drops tool keys that no longer exist in the dataset", () => {
    const withGhost: ForecastInputs = {
      ...SAVED,
      tools: {
        ...SAVED.tools,
        ghost: { include: true, model: "linear", val: 99 },
      },
    };
    const rebased = inputsFromSaved(ds, withGhost);
    expect(rebased.tools.ghost).toBeUndefined();
    expect(Object.keys(rebased.tools).sort()).toEqual([
      "api",
      "claude",
      "copilot",
    ]);
  });

  it("defaults tools the dataset gained since the save", () => {
    const partial: ForecastInputs = {
      ceilingCents: 260000,
      tools: { api: SAVED.tools.api },
    };
    const rebased = inputsFromSaved(ds, partial);
    // copilot/claude were absent from the save → DEFAULT_PARAMS.
    expect(rebased.tools.copilot).toEqual({
      include: true,
      model: "flat",
      val: 0,
    });
    expect(rebased.tools.claude).toEqual({
      include: true,
      model: "flat",
      val: 0,
    });
  });

  it("an empty saved tools record yields all-defaults with the saved ceiling", () => {
    const rebased = inputsFromSaved(ds, { ceilingCents: 123400, tools: {} });
    expect(rebased.ceilingCents).toBe(123400);
    for (const tool of ds.tools) {
      expect(rebased.tools[tool.key]).toEqual({
        include: true,
        model: "flat",
        val: 0,
      });
    }
  });

  it("returns copies — mutating the result never mutates the saved params", () => {
    const rebased = inputsFromSaved(ds, SAVED);
    rebased.tools.api.val = 999;
    rebased.tools.claude.billing = undefined;
    expect(SAVED.tools.api.val).toBe(-25);
    expect(SAVED.tools.claude.billing).toBe("yearly");
  });

  it("a billing value stranded on a non-claudeSeats key copies through but is cost-neutral", () => {
    // e.g. the claude tool's key was reused by a seat-kind tool after a reseed:
    // the engine ignores `billing` on seat/metered kinds (pinned above), so the
    // stranded value must not change a single figure.
    const stranded: ForecastInputs = {
      ceilingCents: 500000,
      tools: {
        api: { include: true, model: "flat", val: 0, burnPct: 0 },
        copilot: {
          include: true,
          model: "flat",
          val: 0,
          billing: "yearly",
        },
        claude: { include: true, model: "flat", val: 0, premShare: 0.25 },
      },
    };
    const without = projectForecast(ds, {
      ...stranded,
      tools: {
        ...stranded.tools,
        copilot: { include: true, model: "flat", val: 0 },
      },
    });
    const withStranded = projectForecast(ds, inputsFromSaved(ds, stranded));
    expect(withStranded.perTool.copilot).toEqual(without.perTool.copilot);
    expect(withStranded.yearEndCents).toBe(without.yearEndCents);
  });
});
