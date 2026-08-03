"use server";

import { db } from "@/lib/db";
import { changeHistory, accessTiers } from "@/lib/db/schema";
import { eq, and, desc, count, inArray } from "drizzle-orm";
import type { ActionResult, ChangeHistoryRecord } from "@/types";

export async function recordCreation(
  entityType: string,
  entityId: number,
  changedBy: number,
  txClient?: Pick<typeof db, "insert">,
) {
  await (txClient ?? db).insert(changeHistory).values({
    entityType,
    entityId,
    changeType: "created",
    changedBy,
  });
}

export async function recordUpdate(
  entityType: string,
  entityId: number,
  changedBy: number,
  changes: Record<string, { old: unknown; new: unknown }>,
  txClient?: Pick<typeof db, "insert">,
) {
  const entries = Object.entries(changes);
  if (entries.length === 0) return;

  await (txClient ?? db).insert(changeHistory).values(
    entries.map(([fieldName, values]) => ({
      entityType,
      entityId,
      changeType: "updated" as const,
      fieldName,
      previousValue: JSON.stringify(values.old),
      newValue: JSON.stringify(values.new),
      changedBy,
    })),
  );
}

/**
 * Record a deletion with a previous-value snapshot so the audit trail can
 * reconstruct what was removed (the deleteBilledCost pattern).
 */
export async function recordDeletion(
  entityType: string,
  entityId: number,
  changedBy: number,
  previousValue: unknown,
  txClient?: Pick<typeof db, "insert">,
) {
  await (txClient ?? db).insert(changeHistory).values({
    entityType,
    entityId,
    changeType: "deleted",
    previousValue: JSON.stringify(previousValue),
    changedBy,
  });
}

export async function recordStatusChange(
  entityType: string,
  entityId: number,
  changedBy: number,
  previousStatus: string,
  newStatus: string,
) {
  await db.insert(changeHistory).values({
    entityType,
    entityId,
    changeType: "status_change",
    fieldName: "status",
    previousValue: JSON.stringify(previousStatus),
    newValue: JSON.stringify(newStatus),
    changedBy,
  });
}

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
  createdAt: Date;
}

/**
 * An assignment's tier-change timeline, newest first, with tier names
 * resolved (change_history stores access_tiers.id as JSON-stringified text —
 * see recordUpdate above and buildTierChange in
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
    with: { changedByUser: true },
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
      createdAt: record.createdAt,
    })),
  };
}
