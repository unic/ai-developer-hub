"use server";

import { db } from "@/lib/db";
import { ingestionLog, users } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-helpers";
import type {
  IngestionChannel,
  IngestionDetails,
  IngestionKind,
  IngestionOutcome,
  IngestionSourceType,
} from "@/types";

export interface IngestionLogRow {
  id: number;
  kind: IngestionKind;
  sourceType: IngestionSourceType | null;
  outcome: IngestionOutcome;
  channel: IngestionChannel;
  label: string | null;
  errorMessage: string | null;
  entityType: string | null;
  entityId: number | null;
  details: IngestionDetails | null;
  uploaderName: string | null;
  createdAt: string;
  /** Retained for the vendor facet during the migration window (P3). */
  vendor: string | null;
}

export async function getIngestionHistory(): Promise<
  { success: true; data: IngestionLogRow[] } | { success: false; error: string }
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const rows = await db
    .select({
      id: ingestionLog.id,
      kind: ingestionLog.kind,
      sourceType: ingestionLog.sourceType,
      outcome: ingestionLog.outcome,
      channel: ingestionLog.channel,
      label: ingestionLog.label,
      errorMessage: ingestionLog.errorMessage,
      entityType: ingestionLog.entityType,
      entityId: ingestionLog.entityId,
      details: ingestionLog.details,
      uploaderName: users.name,
      createdAt: ingestionLog.createdAt,
      vendor: ingestionLog.vendor,
    })
    .from(ingestionLog)
    .leftJoin(users, eq(ingestionLog.uploadedBy, users.id))
    .orderBy(desc(ingestionLog.createdAt))
    .limit(500);

  return {
    success: true,
    data: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
