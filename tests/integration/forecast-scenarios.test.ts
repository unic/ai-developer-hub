import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/lib/db";
import {
  annualBudgets,
  changeHistory,
  forecastScenarios,
  users,
} from "@/lib/db/schema";
import { and, eq, like } from "drizzle-orm";
import type { ForecastInputs } from "@/lib/scenarios/budget-forecast";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ id: "1", role: "admin" }),
}));

import {
  createForecastScenario,
  deleteForecastScenario,
  listForecastScenarios,
  updateForecastScenario,
} from "@/actions/forecast-scenarios";

let adminUserId: number;
let budgetId: number;
let scenarioId: number;

// The actions resolve "the active budget" themselves (status='active' ordered
// by fiscal_year DESC), so the seeded budget must deterministically win that
// resolution against the dev DB's real active budget AND every active budget
// other integration suites seed in parallel (budget-extensions: 2090-2098,
// invoice-sync: up to ~30,259). This suite must own the HIGHEST fiscal year
// in the whole integration run — keep this range above every other suite's.
const ACTIVE_FY = 999_000 + Math.floor(Math.random() * 999);

const PARAMS_V1: ForecastInputs = {
  ceilingCents: 4_200_000,
  tools: {
    api: { include: true, model: "compound", val: -25, burnPct: 0 },
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

const PARAMS_V2: ForecastInputs = {
  ceilingCents: 5_000_000,
  tools: {
    api: { include: false, model: "flat", val: 0 },
    claude: { include: true, model: "linear", val: 20, premShare: 0.35 },
  },
};

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      name: "Forecast Scenario Test Admin",
      email: `forecast-scenario-test-${Date.now()}@test.local`,
      passwordHash: "not-a-real-hash",
      role: "admin",
    })
    .returning({ id: users.id });
  adminUserId = user.id;
  vi.mocked(
    (await import("@/lib/auth-helpers")).requireAdmin,
  ).mockResolvedValue({ id: String(adminUserId), role: "admin" } as never);

  const [budget] = await db
    .insert(annualBudgets)
    .values({
      fiscalYear: ACTIVE_FY,
      totalAmountCents: 4_200_000,
      originalAmountCents: 4_200_000,
      periodType: "monthly",
      status: "active",
    })
    .returning({ id: annualBudgets.id });
  budgetId = budget.id;
});

afterAll(async () => {
  // Cascade delete cleans up any remaining scenarios.
  await db.delete(annualBudgets).where(eq(annualBudgets.id, budgetId));
  await db
    .delete(changeHistory)
    .where(eq(changeHistory.changedBy, adminUserId));
  await db.delete(users).where(eq(users.id, adminUserId));
});

// ── Tests (sequential within the file) ───────────────────────────────────────

describe("forecast-scenario CRUD round trip", () => {
  it("create attaches to the seeded active budget and audits creation", async () => {
    const result = await createForecastScenario({
      name: "Plan B",
      params: PARAMS_V1,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    scenarioId = result.data.id;

    // The action resolved the budget itself — it must be the seeded one.
    const row = await db.query.forecastScenarios.findFirst({
      where: eq(forecastScenarios.id, scenarioId),
    });
    expect(row?.budgetId).toBe(budgetId);
    expect(row?.createdBy).toBe(adminUserId);

    const audit = await db.query.changeHistory.findFirst({
      where: and(
        eq(changeHistory.entityType, "forecast_scenario"),
        eq(changeHistory.entityId, scenarioId),
        eq(changeHistory.changeType, "created"),
      ),
    });
    expect(audit?.changedBy).toBe(adminUserId);
  });

  it("list returns the row with params, creator name, and ISO timestamp", async () => {
    const list = await listForecastScenarios();
    const entry = list.find((s) => s.id === scenarioId);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe("Plan B");
    expect(entry?.params).toEqual(PARAMS_V1);
    expect(entry?.creatorName).toBe("Forecast Scenario Test Admin");
    expect(entry?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("update renames and overwrites params with full audit snapshots", async () => {
    const result = await updateForecastScenario({
      id: scenarioId,
      name: "Console Sunset",
      params: PARAMS_V2,
    });
    expect(result).toEqual({ success: true, data: { id: scenarioId } });

    const row = await db.query.forecastScenarios.findFirst({
      where: eq(forecastScenarios.id, scenarioId),
    });
    expect(row?.name).toBe("Console Sunset");
    expect(row?.params).toEqual(PARAMS_V2);

    const updates = await db.query.changeHistory.findMany({
      where: and(
        eq(changeHistory.entityType, "forecast_scenario"),
        eq(changeHistory.entityId, scenarioId),
        eq(changeHistory.changeType, "updated"),
      ),
    });
    const nameDiff = updates.find((u) => u.fieldName === "name");
    expect(nameDiff && JSON.parse(nameDiff.previousValue!)).toBe("Plan B");
    expect(nameDiff && JSON.parse(nameDiff.newValue!)).toBe("Console Sunset");
    // Full params snapshots — an overwritten plan is recoverable.
    const paramsDiff = updates.find((u) => u.fieldName === "params");
    expect(paramsDiff && JSON.parse(paramsDiff.previousValue!)).toEqual(
      PARAMS_V1,
    );
    expect(paramsDiff && JSON.parse(paramsDiff.newValue!)).toEqual(PARAMS_V2);
  });

  it("rename-only update leaves stored params untouched", async () => {
    const result = await updateForecastScenario({
      id: scenarioId,
      name: "Console Sunset v2",
    });
    expect(result.success).toBe(true);

    const row = await db.query.forecastScenarios.findFirst({
      where: eq(forecastScenarios.id, scenarioId),
    });
    expect(row?.name).toBe("Console Sunset v2");
    expect(row?.params).toEqual(PARAMS_V2);
  });

  it("rejects a case-variant duplicate name via the action", async () => {
    const result = await createForecastScenario({
      name: "console sunset V2",
      params: PARAMS_V1,
    });
    expect(result).toEqual({
      success: false,
      error: "A scenario with this name already exists for this budget",
    });
  });

  it("allows renaming a scenario to a case variant of its own name", async () => {
    const result = await updateForecastScenario({
      id: scenarioId,
      name: "CONSOLE SUNSET V2",
    });
    expect(result.success).toBe(true);
  });

  it("the unique expression index fires on a direct case-variant insert", async () => {
    // Bypasses the action's pre-check — proves migration 0026's index is the
    // real race backstop.
    await expect(
      db.insert(forecastScenarios).values({
        budgetId,
        name: "Console Sunset V2",
        params: PARAMS_V1,
        createdBy: adminUserId,
      }),
    ).rejects.toThrow();
  });

  it("list skips rows whose stored params no longer conform", async () => {
    const [corrupt] = await db
      .insert(forecastScenarios)
      .values({
        budgetId,
        name: "Corrupt Row",
        params: { ceilingCents: "oops" } as unknown as ForecastInputs,
        createdBy: adminUserId,
      })
      .returning({ id: forecastScenarios.id });

    const list = await listForecastScenarios();
    expect(list.find((s) => s.id === corrupt.id)).toBeUndefined();
    expect(list.find((s) => s.id === scenarioId)).toBeDefined();

    await db
      .delete(forecastScenarios)
      .where(eq(forecastScenarios.id, corrupt.id));
  });

  it("enforces the 50-per-budget cap with a friendly error", async () => {
    const existing = await db
      .select({ id: forecastScenarios.id })
      .from(forecastScenarios)
      .where(eq(forecastScenarios.budgetId, budgetId));
    // Bulk-seed up to the cap in one insert (50 action calls would serialize
    // ~250 Neon round trips and brush the 30s timeout).
    const fillers = Array.from({ length: 50 - existing.length }, (_, i) => ({
      budgetId,
      name: `Filler ${i + 1}`,
      params: PARAMS_V1,
      createdBy: adminUserId,
    }));
    await db.insert(forecastScenarios).values(fillers);

    const result = await createForecastScenario({
      name: "One Too Many",
      params: PARAMS_V1,
    });
    expect(result).toEqual({
      success: false,
      error: "Scenario limit reached (50) — delete one first",
    });

    await db
      .delete(forecastScenarios)
      .where(
        and(
          eq(forecastScenarios.budgetId, budgetId),
          like(forecastScenarios.name, "Filler %"),
        ),
      );
  });

  it("delete snapshots the row into change_history", async () => {
    const result = await deleteForecastScenario(scenarioId);
    expect(result).toEqual({ success: true, data: { id: scenarioId } });

    const audit = await db.query.changeHistory.findFirst({
      where: and(
        eq(changeHistory.entityType, "forecast_scenario"),
        eq(changeHistory.entityId, scenarioId),
        eq(changeHistory.changeType, "deleted"),
      ),
    });
    expect(audit).toBeDefined();
    const snapshot = JSON.parse(audit!.previousValue!);
    expect(snapshot.budgetId).toBe(budgetId);
    expect(snapshot.name).toBe("CONSOLE SUNSET V2");
    expect(snapshot.params).toEqual(PARAMS_V2);

    expect(await deleteForecastScenario(scenarioId)).toEqual({
      success: false,
      error: "Scenario not found",
    });
  });

  it("leaves the seeded budget with no scenarios", async () => {
    const remaining = await db
      .select({ id: forecastScenarios.id })
      .from(forecastScenarios)
      .where(eq(forecastScenarios.budgetId, budgetId));
    expect(remaining).toEqual([]);
    expect(await listForecastScenarios()).toEqual([]);
  });
});
