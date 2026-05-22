// Idempotency ledger for Teams alert posts.
// Schema: anthropic_alert_state in src/lib/db/schema.ts.
// Auth-free; callers are the evaluator and tests.

import "server-only";

import { db } from "@/lib/db";
import { anthropicAlertState } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import type { AlertStateRow } from "./types";

export async function readAlertState(month: string): Promise<AlertStateRow[]> {
  const rows = await db
    .select()
    .from(anthropicAlertState)
    .where(eq(anthropicAlertState.billingMonth, month));
  return rows.map((r) => ({
    workspaceId: r.workspaceId,
    billingMonth: r.billingMonth,
    threshold80FiredAt: r.threshold80FiredAt,
    threshold100FiredAt: r.threshold100FiredAt,
    threshold120FiredAt: r.threshold120FiredAt,
    forecastAtRisk: r.forecastAtRisk,
    forecastChangedAt: r.forecastChangedAt,
  }));
}

/**
 * Persist post-evaluation state. The two-partial-unique-indexes pattern (one
 * `WHERE workspace_id IS NOT NULL`, one `IS NULL`) means we can't share a
 * single `onConflictDoUpdate` target across both — split into two statements.
 *
 * Caller (evaluator) runs inside `withSyncLock`, so no concurrent writer can
 * race here; no transaction needed.
 */
export async function upsertAlertState(rows: AlertStateRow[]): Promise<void> {
  if (rows.length === 0) return;

  const namedRows = rows.filter((r) => r.workspaceId !== null);
  const defaultRow = rows.find((r) => r.workspaceId === null);

  if (namedRows.length > 0) {
    await db
      .insert(anthropicAlertState)
      .values(namedRows.map(toInsertValues))
      .onConflictDoUpdate({
        target: [anthropicAlertState.workspaceId, anthropicAlertState.billingMonth],
        targetWhere: sql`${anthropicAlertState.workspaceId} IS NOT NULL`,
        set: {
          threshold80FiredAt: sql`excluded.threshold_80_fired_at`,
          threshold100FiredAt: sql`excluded.threshold_100_fired_at`,
          threshold120FiredAt: sql`excluded.threshold_120_fired_at`,
          forecastAtRisk: sql`excluded.forecast_at_risk`,
          forecastChangedAt: sql`excluded.forecast_changed_at`,
          updatedAt: sql`now()`,
        },
      });
  }

  if (defaultRow) {
    // ON CONFLICT can't target a partial unique index whose predicate involves
    // a NULL column. Update-or-insert with WHERE IS NULL (safe under
    // withSyncLock — there is at most one default-workspace row per month).
    const updated = await db
      .update(anthropicAlertState)
      .set({
        threshold80FiredAt: defaultRow.threshold80FiredAt,
        threshold100FiredAt: defaultRow.threshold100FiredAt,
        threshold120FiredAt: defaultRow.threshold120FiredAt,
        forecastAtRisk: defaultRow.forecastAtRisk,
        forecastChangedAt: defaultRow.forecastChangedAt,
        updatedAt: new Date(),
      })
      .where(
        sql`${anthropicAlertState.workspaceId} IS NULL AND ${anthropicAlertState.billingMonth} = ${defaultRow.billingMonth}`,
      );
    if (updated.rowCount === 0) {
      await db.insert(anthropicAlertState).values(toInsertValues(defaultRow));
    }
  }
}

function toInsertValues(row: AlertStateRow) {
  return {
    workspaceId: row.workspaceId,
    billingMonth: row.billingMonth,
    threshold80FiredAt: row.threshold80FiredAt,
    threshold100FiredAt: row.threshold100FiredAt,
    threshold120FiredAt: row.threshold120FiredAt,
    forecastAtRisk: row.forecastAtRisk,
    forecastChangedAt: row.forecastChangedAt,
  };
}
