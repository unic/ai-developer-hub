"use server";

import { db } from "@/lib/db";
import {
  annualBudgets,
  changeHistory,
  forecastScenarios,
  users,
} from "@/lib/db/schema";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { recordCreation, recordUpdate } from "@/actions/history";
import {
  createForecastScenarioSchema,
  deleteForecastScenarioSchema,
  forecastInputsSchema,
  updateForecastScenarioSchema,
} from "@/lib/validators";
import type { ForecastInputs } from "@/lib/scenarios/budget-forecast";
import type { ActionResult } from "@/types";

/**
 * CRUD for saved forecast scenarios (spec 041) — named, shared ForecastInputs
 * parameter sets scoped to the active budget. The cached dataset loaders stay
 * in scenarios.ts; this file owns the section's first write path.
 */

const SCENARIO_PAGE = "/scenarios/budget-forecast";
const ENTITY_TYPE = "forecast_scenario";
/** UX guardrail, pre-check only (no DB backstop — a racy 51st row is harmless). */
const MAX_SCENARIOS_PER_BUDGET = 50;

export interface SavedForecastScenario {
  id: number;
  name: string;
  params: ForecastInputs;
  creatorName: string | null;
  updatedAt: string;
}

/**
 * Resolve the budget scenarios attach to. The schema permits multiple
 * status='active' rows, so the contract is deterministic: the active budget
 * with the highest fiscal year wins.
 */
async function resolveActiveBudgetId(): Promise<number | null> {
  const [budget] = await db
    .select({ id: annualBudgets.id })
    .from(annualBudgets)
    .where(eq(annualBudgets.status, "active"))
    .orderBy(desc(annualBudgets.fiscalYear))
    .limit(1);
  return budget?.id ?? null;
}

/** Case-insensitive duplicate-name probe, optionally excluding a row (update). */
async function nameTaken(
  budgetId: number,
  name: string,
  excludeId?: number,
): Promise<boolean> {
  const conditions = [
    eq(forecastScenarios.budgetId, budgetId),
    sql`lower(${forecastScenarios.name}) = lower(${name})`,
  ];
  if (excludeId !== undefined) {
    conditions.push(ne(forecastScenarios.id, excludeId));
  }
  const [existing] = await db
    .select({ id: forecastScenarios.id })
    .from(forecastScenarios)
    .where(and(...conditions))
    .limit(1);
  return existing !== undefined;
}

/** True when an error is the unique-index violation on (budget_id, lower(name)). */
function isDuplicateNameViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: unknown }).code === "23505"
  );
}

const DUPLICATE_NAME_ERROR =
  "A scenario with this name already exists for this budget";

/**
 * Saved scenarios for the active budget, ordered by name. The admin gate
 * returning [] is defense-in-depth only — the /scenarios layout already
 * redirects non-admins, and the page's dataset loader throws first.
 */
export async function listForecastScenarios(): Promise<
  SavedForecastScenario[]
> {
  const admin = await requireAdmin();
  if (!admin) return [];

  const budgetId = await resolveActiveBudgetId();
  if (budgetId === null) return [];

  const rows = await db
    .select({
      id: forecastScenarios.id,
      name: forecastScenarios.name,
      params: forecastScenarios.params,
      creatorName: users.name,
      updatedAt: forecastScenarios.updatedAt,
    })
    .from(forecastScenarios)
    .leftJoin(users, eq(forecastScenarios.createdBy, users.id))
    .where(eq(forecastScenarios.budgetId, budgetId))
    .orderBy(asc(forecastScenarios.name));

  // Validate on read: the jsonb column is an open contract — a row that no
  // longer conforms is skipped (loudly), never allowed to crash the page.
  const out: SavedForecastScenario[] = [];
  for (const row of rows) {
    const parsed = forecastInputsSchema.safeParse(row.params);
    if (!parsed.success) {
      console.error(
        `[forecast-scenarios] Skipping scenario ${row.id} ("${row.name}"): stored params no longer conform`,
      );
      continue;
    }
    out.push({
      id: row.id,
      name: row.name,
      params: parsed.data,
      creatorName: row.creatorName,
      updatedAt: row.updatedAt.toISOString(),
    });
  }
  return out;
}

export async function createForecastScenario(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = createForecastScenarioSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  const budgetId = await resolveActiveBudgetId();
  if (budgetId === null) {
    return { success: false, error: "No active budget" };
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(forecastScenarios)
    .where(eq(forecastScenarios.budgetId, budgetId));
  if (count >= MAX_SCENARIOS_PER_BUDGET) {
    return {
      success: false,
      error: `Scenario limit reached (${MAX_SCENARIOS_PER_BUDGET}) — delete one first`,
    };
  }

  if (await nameTaken(budgetId, parsed.data.name)) {
    return { success: false, error: DUPLICATE_NAME_ERROR };
  }

  let created: { id: number };
  try {
    [created] = await db
      .insert(forecastScenarios)
      .values({
        budgetId,
        name: parsed.data.name,
        params: parsed.data.params,
        createdBy: Number(admin.id),
      })
      .returning({ id: forecastScenarios.id });
  } catch (e) {
    // The unique index is the race backstop behind the pre-check; its
    // violation must honour the ActionResult contract, not surface a digest.
    if (isDuplicateNameViolation(e)) {
      return { success: false, error: DUPLICATE_NAME_ERROR };
    }
    throw e;
  }

  await recordCreation(ENTITY_TYPE, created.id, Number(admin.id));

  revalidatePath(SCENARIO_PAGE);
  return { success: true, data: { id: created.id } };
}

export async function updateForecastScenario(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = updateForecastScenarioSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }
  const { id, name, params } = parsed.data;

  const scenario = await db.query.forecastScenarios.findFirst({
    where: eq(forecastScenarios.id, id),
  });
  if (!scenario) return { success: false, error: "Scenario not found" };

  if (await nameTaken(scenario.budgetId, name, id)) {
    return { success: false, error: DUPLICATE_NAME_ERROR };
  }

  try {
    await db
      .update(forecastScenarios)
      .set({
        name,
        // Omitted params = rename-only; stored assumptions stay untouched.
        ...(params !== undefined ? { params } : {}),
        updatedAt: new Date(),
      })
      .where(eq(forecastScenarios.id, id));
  } catch (e) {
    if (isDuplicateNameViolation(e)) {
      return { success: false, error: DUPLICATE_NAME_ERROR };
    }
    throw e;
  }

  // Full params snapshots make a teammate's overwritten plan recoverable from
  // change_history — and guarantee a params-only update still records a row
  // (recordUpdate early-returns on an empty diff).
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  if (name !== scenario.name) {
    changes.name = { old: scenario.name, new: name };
  }
  if (params !== undefined) {
    changes.params = { old: scenario.params, new: params };
  }
  await recordUpdate(ENTITY_TYPE, id, Number(admin.id), changes);

  revalidatePath(SCENARIO_PAGE);
  return { success: true, data: { id } };
}

export async function deleteForecastScenario(
  id: number,
): Promise<ActionResult<{ id: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = deleteForecastScenarioSchema.safeParse({ id });
  if (!parsed.success) {
    return { success: false, error: "Invalid scenario ID" };
  }

  const scenario = await db.query.forecastScenarios.findFirst({
    where: eq(forecastScenarios.id, parsed.data.id),
  });
  if (!scenario) return { success: false, error: "Scenario not found" };

  // Record deletion with a previous-value snapshot (deleteBilledCost pattern)
  // so the audit trail can reconstruct what was removed.
  await db.insert(changeHistory).values({
    entityType: ENTITY_TYPE,
    entityId: scenario.id,
    changeType: "deleted",
    previousValue: JSON.stringify({
      budgetId: scenario.budgetId,
      name: scenario.name,
      params: scenario.params,
    }),
    changedBy: Number(admin.id),
  });

  await db
    .delete(forecastScenarios)
    .where(eq(forecastScenarios.id, scenario.id));

  revalidatePath(SCENARIO_PAGE);
  return { success: true, data: { id: scenario.id } };
}
