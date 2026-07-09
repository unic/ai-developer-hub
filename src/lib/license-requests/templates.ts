// Template resolution helpers for the license-request workflow.
// Spec 032-automation-workflow Phase 4.

import "server-only";
import { db } from "@/lib/db";
import { messageTemplates } from "@/lib/db/schema";
import { and, eq, isNull, or } from "drizzle-orm";

export type TemplateKind = "approval" | "completion";

/**
 * Resolve the right template body for a (tool, tier, kind) combination.
 *
 * Lookup priority:
 *   1. tier-specific override        (tool_id = X, tier_id = Y, kind = K)
 *   2. tool-wide default             (tool_id = X, tier_id = NULL, kind = K)
 *   3. null                          (caller surfaces "no template" state)
 */
export async function findTemplate(
  toolId: number,
  tierId: number | null,
  kind: TemplateKind,
): Promise<string | null> {
  // One query, both candidates — let Postgres pick the more specific row.
  const candidates = await db
    .select({
      bodyMd: messageTemplates.bodyMd,
      tierId: messageTemplates.tierId,
    })
    .from(messageTemplates)
    .where(
      and(
        eq(messageTemplates.toolId, toolId),
        eq(messageTemplates.kind, kind),
        tierId === null
          ? isNull(messageTemplates.tierId)
          : or(
              eq(messageTemplates.tierId, tierId),
              isNull(messageTemplates.tierId),
            ),
      ),
    );

  if (candidates.length === 0) return null;

  // Prefer the tier-specific override when both rows exist
  const specific = candidates.find((c) => c.tierId === tierId && tierId !== null);
  if (specific) return specific.bodyMd;
  const fallback = candidates.find((c) => c.tierId === null);
  return fallback?.bodyMd ?? candidates[0].bodyMd;
}

export interface ApprovalTemplateRow {
  toolId: number;
  tierId: number | null;
  bodyMd: string;
}

/** All approval templates in one list (032-v2). The approve dialog lets the
 * admin switch the tool (override / indie pick), so the client resolves
 * override(tool, tier) → default(tool) → empty over this small set instead of
 * paying a roundtrip per selection change. */
export async function listApprovalTemplates(): Promise<ApprovalTemplateRow[]> {
  return db
    .select({
      toolId: messageTemplates.toolId,
      tierId: messageTemplates.tierId,
      bodyMd: messageTemplates.bodyMd,
    })
    .from(messageTemplates)
    .where(eq(messageTemplates.kind, "approval"));
}
