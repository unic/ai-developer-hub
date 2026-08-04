"use server";

import { db } from "@/lib/db";
import { changeHistory } from "@/lib/db/schema";
import { eq, and, desc, count } from "drizzle-orm";
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
