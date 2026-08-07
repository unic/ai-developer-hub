import { db } from "@/lib/db";
import { githubConnections } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * The name syncBillingData upserts the Copilot tool under. That upsert is keyed
 * on the name (lib/copilot-sync.ts), so it is the tool's real identity as far as
 * sync is concerned.
 */
export const COPILOT_SYNC_TOOL_NAME = "GitHub Copilot";

/**
 * Is Copilot sync actually running? One query.
 *
 * Callers that already hold a tool row combine this with
 * `isSyncManagedToolName` themselves; there is deliberately no id-based variant,
 * because every caller turned out to have the tool's name in hand already and an
 * id-based lookup meant a second `ai_tools` round trip for data the caller had
 * just fetched and discarded.
 */
export async function isCopilotSyncActive(): Promise<boolean> {
  const connection = await db.query.githubConnections.findFirst({
    where: and(
      eq(githubConnections.status, "active"),
      eq(githubConnections.copilotSyncEnabled, true),
    ),
    columns: { id: true },
  });
  return connection !== undefined;
}

/** Pure name check — pair with isCopilotSyncActive(). */
export function isSyncManagedToolName(toolName: string): boolean {
  return toolName === COPILOT_SYNC_TOOL_NAME;
}

/**
 * Is this tool's tier assignment owned by GitHub rather than the Hub? (spec 042)
 *
 * Gated on the TOOL, not on assignment.source, and that distinction is the whole
 * point. syncSeatAssignments takes over manual rows — it sets
 * source='copilot-sync' whenever it sees a seat it does not already own — so a
 * tier change on a source='manual' Copilot assignment is reverted by the next
 * cron just as surely as one on an already-synced row. Gating on source would
 * have left exactly that hole open.
 *
 * Returns false when sync is not running (no active connection, or sync disabled
 * on it), because then nothing will overwrite a manual change and there is no
 * reason to forbid it.
 */
export async function isSyncManagedTool(toolName: string): Promise<boolean> {
  if (!isSyncManagedToolName(toolName)) return false;
  return isCopilotSyncActive();
}
