/**
 * One-off backfill for anthropic_sync_status.resolved_workspace_id.
 *
 * Background:
 *   The `resolved_workspace_id` column was added (spec 026 / migration 0018)
 *   after most users were already resolved via spec 016. The ongoing
 *   `resolveAllMappings()` in src/lib/anthropic-sync.ts only re-resolves
 *   users that lack a `resolvedApiKeyId` (or whose key has changed), so
 *   pre-existing rows kept `resolved_workspace_id = NULL` forever — which
 *   broke the per-workspace user/model breakdowns on the drill-down.
 *
 *   This script re-queries Anthropic's `/v1/organizations/api_keys`
 *   endpoint once and updates `resolved_workspace_id` for every row that
 *   already has a `resolved_api_key_id`. Idempotent — safe to re-run.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/backfill-anthropic-workspace-mapping.ts
 */

import { eq, isNotNull } from "drizzle-orm";
import { db } from "../src/lib/db";
import { anthropicSyncStatus } from "../src/lib/db/schema";
import { fetchOrgApiKeys } from "../src/lib/anthropic-keys";

async function main() {
  console.log("Fetching all org API keys from Anthropic…");
  const orgKeys = await fetchOrgApiKeys();
  console.log(`  Got ${orgKeys.length} active keys.`);

  const byId = new Map<string, string | null>();
  for (const k of orgKeys) byId.set(k.id, k.workspace_id ?? null);

  const rows = await db.query.anthropicSyncStatus.findMany({
    where: isNotNull(anthropicSyncStatus.resolvedApiKeyId),
  });
  console.log(`Found ${rows.length} sync_status rows with a resolved api_key_id.`);

  let updated = 0;
  let missingFromOrg = 0;
  let unchanged = 0;
  for (const row of rows) {
    if (!row.resolvedApiKeyId) continue;
    if (!byId.has(row.resolvedApiKeyId)) {
      missingFromOrg++;
      continue;
    }
    const wsId = byId.get(row.resolvedApiKeyId) ?? null;
    if (wsId === row.resolvedWorkspaceId) {
      unchanged++;
      continue;
    }
    await db
      .update(anthropicSyncStatus)
      .set({ resolvedWorkspaceId: wsId })
      .where(eq(anthropicSyncStatus.userId, row.userId));
    updated++;
  }

  console.log(
    `Done. Updated: ${updated}, unchanged: ${unchanged}, missing from org listing: ${missingFromOrg}.`
  );
  if (missingFromOrg > 0) {
    console.warn(
      "  (Rows tagged 'missing from org listing' have an api_key_id that Anthropic no longer returns — the key was deleted or rotated. These rows keep their current resolved_workspace_id.)"
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
