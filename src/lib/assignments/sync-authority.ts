import { db } from "@/lib/db";
import { aiTools, githubConnections } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * The name syncBillingData upserts the Copilot tool under. That upsert is keyed
 * on the name (lib/copilot-sync.ts), so it is the tool's real identity as far as
 * sync is concerned.
 */
export const COPILOT_SYNC_TOOL_NAME = "GitHub Copilot";

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
 * Returns false when Copilot sync is not actually running (no active connection,
 * or the connection has sync disabled), because then nothing will overwrite a
 * manual change and there is no reason to forbid it.
 */
export async function isSyncManagedTool(toolId: number): Promise<boolean> {
  const syncManagedToolId = await getSyncManagedToolId();
  return syncManagedToolId !== null && syncManagedToolId === toolId;
}

/**
 * The id of the tool Copilot sync currently owns, or null when sync is not
 * running. One query pair, so callers that need to mark up a whole list (e.g. the
 * approval dialog's collision check) do not call isSyncManagedTool per row.
 */
export async function getSyncManagedToolId(): Promise<number | null> {
  const connection = await db.query.githubConnections.findFirst({
    where: and(
      eq(githubConnections.status, "active"),
      eq(githubConnections.copilotSyncEnabled, true),
    ),
    columns: { id: true },
  });
  if (!connection) return null;

  const tool = await db.query.aiTools.findFirst({
    where: eq(aiTools.name, COPILOT_SYNC_TOOL_NAME),
    columns: { id: true },
  });
  return tool?.id ?? null;
}
