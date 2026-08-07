"use server";

import { db } from "@/lib/db";
import { changeHistory, accessTiers } from "@/lib/db/schema";
import { eq, and, desc, count, inArray } from "drizzle-orm";
import type { ActionResult, ChangeHistoryRecord } from "@/types";

/**
 * Read side of the audit trail. The WRITE helpers deliberately do not live here
 * — see src/lib/history.ts for why (a `"use server"` export that takes
 * `changedBy` as a parameter is an audit-forgery endpoint).
 */
export async function getEntityHistory(
  entityType: string,
  entityId: number,
  limit = 50,
  offset = 0,
): Promise<ActionResult<{ records: ChangeHistoryRecord[]; total: number }>> {
  const [records, [totalRow]] = await Promise.all([
    db.query.changeHistory.findMany({
      where: and(
        eq(changeHistory.entityType, entityType),
        eq(changeHistory.entityId, entityId),
      ),
      orderBy: desc(changeHistory.createdAt),
      limit,
      offset,
    }),
    db
      .select({ count: count() })
      .from(changeHistory)
      .where(
        and(
          eq(changeHistory.entityType, entityType),
          eq(changeHistory.entityId, entityId),
        ),
      ),
  ]);

  return {
    success: true,
    data: {
      records,
      total: totalRow?.count ?? 0,
    },
  };
}

export interface TierChangeEntry {
  id: number;
  previousTierName: string | null;
  newTierName: string | null;
  changedByName: string;
  /**
   * Where the retier came from (`change_history.source`, migration 0031). A
   * non-'ui' entry was written by an agent or an automation under a real admin's
   * `changedBy`, so rendering the name alone would show it as an ordinary human
   * form edit.
   *
   * Typed `string`, not `ChangeSource`: the column is a plain varchar, so the
   * DB — not the union in src/lib/history.ts — is what a reader actually gets.
   * Every consumer's predicate is `!== "ui"`, which stays correct (and fails
   * toward showing provenance) for a value written before the union catches up.
   */
  source: string;
  createdAt: Date;
}

/**
 * An assignment's tier-change timeline, newest first, with tier names
 * resolved (change_history stores access_tiers.id as JSON-stringified text —
 * see recordUpdate in src/lib/history.ts and buildTierChange in
 * src/lib/assignments/tier-change.ts) and the actor's name joined in. Spec 042
 * reads this instead of adding a column: change_history already has old/new
 * tierId, changedBy and createdAt for every retier.
 */
export async function getAssignmentTierHistory(
  assignmentId: number,
): Promise<ActionResult<TierChangeEntry[]>> {
  const records = await db.query.changeHistory.findMany({
    where: and(
      eq(changeHistory.entityType, "license_assignment"),
      eq(changeHistory.entityId, assignmentId),
      eq(changeHistory.fieldName, "tierId"),
    ),
    orderBy: desc(changeHistory.createdAt),
    // Only the actor's name is rendered. `changedByUser: true` would select the
    // whole users row — password_hash included — into memory for no reason.
    with: { changedByUser: { columns: { name: true } } },
  });

  if (records.length === 0) {
    return { success: true, data: [] };
  }

  const tierIds = new Set<number>();
  for (const record of records) {
    if (record.previousValue) tierIds.add(JSON.parse(record.previousValue));
    if (record.newValue) tierIds.add(JSON.parse(record.newValue));
  }

  const tiers = await db.query.accessTiers.findMany({
    where: inArray(accessTiers.id, [...tierIds]),
    columns: { id: true, name: true },
  });
  const tierNameById = new Map(tiers.map((t) => [t.id, t.name]));

  return {
    success: true,
    data: records.map((record) => ({
      id: record.id,
      previousTierName: record.previousValue
        ? (tierNameById.get(JSON.parse(record.previousValue)) ?? "an unknown tier")
        : null,
      newTierName: record.newValue
        ? (tierNameById.get(JSON.parse(record.newValue)) ?? "an unknown tier")
        : null,
      changedByName: record.changedByUser.name,
      source: record.source,
      createdAt: record.createdAt,
    })),
  };
}
