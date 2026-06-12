import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  createForecastScenarioSchema,
  deleteForecastScenarioSchema,
  forecastInputsSchema,
  toolParamsSchema,
  updateForecastScenarioSchema,
} from "@/lib/validators";
import type { ForecastInputs } from "@/lib/scenarios/budget-forecast";

/**
 * Boundary schemas for the forecast_scenarios jsonb params column (spec 041).
 * The same schema runs on write (canonical shape) and on read (rows that no
 * longer conform are skipped), so the accept/reject matrix below is the load-
 * bearing safety contract for the engine's math.
 */

/** A realistic tuned parameter set, as the client would submit it. */
const VALID_INPUTS: ForecastInputs = {
  ceilingCents: 4200000,
  tools: {
    api: {
      include: true,
      model: "compound",
      val: -25,
      burnPct: 0,
      burnCap: 5500,
    },
    claude: {
      include: true,
      model: "linear",
      val: 15,
      premShare: 0.4,
      billing: "yearly",
    },
    copilot: { include: false, model: "flat", val: 0 },
  },
};

// Type-level round trip, enforced by `pnpm typecheck` (tests are included in
// the tsconfig): the schema's inferred type and the engine's hand-written
// ForecastInputs must stay mutually assignable.
type SchemaOutput = z.infer<typeof forecastInputsSchema>;
const _schemaToEngine: ForecastInputs = {} as SchemaOutput;
const _engineToSchema: SchemaOutput = {} as ForecastInputs;
void _schemaToEngine;
void _engineToSchema;

// Assignability alone cannot catch a forgotten OPTIONAL lever (an object
// missing `billing?` is still assignable both ways — exactly how a new lever
// would silently strip on save). Key-set equality does: if ToolParams gains a
// field the schema doesn't know, this constant stops typechecking.
type KeysMatch<A, B> = [
  Exclude<keyof A, keyof B> | Exclude<keyof B, keyof A>,
] extends [never]
  ? true
  : false;
type SchemaToolParams = z.infer<typeof toolParamsSchema>;
const _toolParamKeysMatch: KeysMatch<
  SchemaToolParams,
  ForecastInputs["tools"][string]
> = true;
const _inputKeysMatch: KeysMatch<SchemaOutput, ForecastInputs> = true;
void _toolParamKeysMatch;
void _inputKeysMatch;

describe("forecastInputsSchema", () => {
  it("accepts a realistic tuned parameter set and returns it intact", () => {
    const parsed = forecastInputsSchema.safeParse(VALID_INPUTS);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(VALID_INPUTS);
  });

  it("accepts a ceiling of 0 (the UI guards the accidental-empty path)", () => {
    expect(
      forecastInputsSchema.safeParse({ ...VALID_INPUTS, ceilingCents: 0 })
        .success,
    ).toBe(true);
  });

  it("accepts an empty tools record (every tool defaults on load)", () => {
    expect(
      forecastInputsSchema.safeParse({ ceilingCents: 100, tools: {} }).success,
    ).toBe(true);
  });

  it("rejects negative, fractional, and over-cap ceilings", () => {
    for (const ceilingCents of [-1, 0.5, 100_000_000_001]) {
      expect(
        forecastInputsSchema.safeParse({ ...VALID_INPUTS, ceilingCents })
          .success,
      ).toBe(false);
    }
  });

  it("rejects more than 20 tool entries", () => {
    const tools: Record<string, unknown> = {};
    for (let i = 0; i < 21; i++) {
      tools[`tool${i}`] = { include: true, model: "flat", val: 0 };
    }
    expect(
      forecastInputsSchema.safeParse({ ceilingCents: 100, tools }).success,
    ).toBe(false);
  });

  it("strips unknown keys instead of rejecting (rows stay loadable across schema evolution)", () => {
    const parsed = forecastInputsSchema.safeParse({
      ...VALID_INPUTS,
      futureField: "from a newer build",
      tools: {
        api: {
          include: true,
          model: "flat",
          val: 0,
          futureLever: 42,
        },
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("futureField" in parsed.data).toBe(false);
      expect("futureLever" in parsed.data.tools.api).toBe(false);
    }
  });
});

describe("toolParamsSchema", () => {
  const base = { include: true, model: "flat", val: 0 };

  it("rejects non-finite val (NaN/Infinity can never reach Math.pow)", () => {
    // Zod 4's z.number() rejects NaN and Infinity by default.
    for (const val of [Number.NaN, Infinity, -Infinity]) {
      expect(toolParamsSchema.safeParse({ ...base, val }).success).toBe(false);
    }
  });

  it("rejects out-of-bounds levers", () => {
    expect(toolParamsSchema.safeParse({ ...base, val: 100_001 }).success).toBe(
      false,
    );
    expect(
      toolParamsSchema.safeParse({ ...base, premShare: 1.01 }).success,
    ).toBe(false);
    expect(toolParamsSchema.safeParse({ ...base, burnPct: -101 }).success).toBe(
      false,
    );
    expect(toolParamsSchema.safeParse({ ...base, burnCap: -1 }).success).toBe(
      false,
    );
    expect(toolParamsSchema.safeParse({ ...base, burnCap: 0.5 }).success).toBe(
      false,
    );
  });

  it("rejects unknown growth models and billing values", () => {
    expect(
      toolParamsSchema.safeParse({ ...base, model: "exponential" }).success,
    ).toBe(false);
    expect(
      toolParamsSchema.safeParse({ ...base, billing: "weekly" }).success,
    ).toBe(false);
  });
});

describe("create/update/delete scenario schemas", () => {
  it("create requires a non-empty trimmed name of at most 60 chars", () => {
    expect(
      createForecastScenarioSchema.safeParse({
        name: "  Plan B  ",
        params: VALID_INPUTS,
      }),
    ).toMatchObject({ success: true, data: { name: "Plan B" } });
    expect(
      createForecastScenarioSchema.safeParse({
        name: "   ",
        params: VALID_INPUTS,
      }).success,
    ).toBe(false);
    expect(
      createForecastScenarioSchema.safeParse({
        name: "x".repeat(61),
        params: VALID_INPUTS,
      }).success,
    ).toBe(false);
  });

  it("update accepts an omitted params (rename-only)", () => {
    const parsed = updateForecastScenarioSchema.safeParse({
      id: 7,
      name: "Renamed",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.params).toBeUndefined();
  });

  it("update and delete require a positive integer id", () => {
    expect(
      updateForecastScenarioSchema.safeParse({ id: 0, name: "x" }).success,
    ).toBe(false);
    expect(deleteForecastScenarioSchema.safeParse({ id: -1 }).success).toBe(
      false,
    );
    expect(deleteForecastScenarioSchema.safeParse({ id: 3.5 }).success).toBe(
      false,
    );
  });
});
