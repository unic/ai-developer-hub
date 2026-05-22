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

/** Convenience used by the template editor: list the form_payload keys
 * seen across the most recent N requests for a tool. Lets the editor's
 * variable picker surface the *available* `{{form.*}}` keys instead of
 * making the user guess. */
export async function recentFormPayloadKeys(
  toolId: number,
  limit = 30,
): Promise<string[]> {
  const rows = await db.query.licenseRequests.findMany({
    where: (lr, { eq: e }) => e(lr.requestedToolId, toolId),
    columns: { formPayload: true },
    orderBy: (lr, { desc }) => [desc(lr.createdAt)],
    limit,
  });
  const keys = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row.formPayload ?? {})) keys.add(k);
  }
  return Array.from(keys).sort();
}
