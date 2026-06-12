"use server";

import { db } from "@/lib/db";
import { changeHistory } from "@/lib/db/schema";
import { eq, and, desc, count } from "drizzle-orm";
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
