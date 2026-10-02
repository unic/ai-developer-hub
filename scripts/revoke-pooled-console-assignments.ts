/**
 * Spec 045 (US9 / T057) — revoke the Claude Console licences on the deprecated
 * pooled workspaces.
 *
 * These licences were deactivated in the Claude Console some time ago; the Hub
 * has been carrying them as active ever since, which is why the licence
 * register reads $3,650/month of allowance for a portfolio that consumed
 * $398.69 in August.
 *
 * Two decisions are baked in, both taken in the spec:
 *  - The revocation date is 2026-07-01 (OQ-3), NOT today. Org-wide Claude API
 *    spend collapsed from $3,016.86 in June to $194.89 in July, so that is when
 *    these licences stopped being real. Budget periods ending before that date
 *    keep counting them — revoking does not rewrite the past (FR-028).
 *  - Selection is by WORKSPACE, never by tier (FR-029): a boost-tier assignment
 *    on a live workspace must be left alone. Assignment 262 is the one explicit
 *    exception, revoked by name under OQ-4.
 *
 * Runs through revokeLicenseCore so change history is written for every one
 * (FR-030). Idempotent: an already-inactive assignment is a no-op.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/revoke-pooled-console-assignments.ts [--commit]
 *
 * Without --commit it prints exactly what it would do and changes nothing.
 */

import { db } from "../src/lib/db";
import { sql } from "drizzle-orm";
import { revokeLicenseCore } from "../src/lib/core/assignments";
import { uiContext } from "../src/lib/core/context";

const REVOCATION_DATE = new Date("2026-07-01T00:00:00Z");
const EXPLICIT_EXTRA_ASSIGNMENT_IDS = [262]; // spec OQ-4
const CLAUDE_CONSOLE_TOOL_ID = 2;

async function main() {
  const commit = process.argv.includes("--commit");
  const actorId = Number(process.env.SYSTEM_ADMIN_USER_ID ?? 1);

  const rows = (
    await db.execute(sql`
      SELECT la.id, u.email, t.name AS tier, la.workspace,
             la.cost_at_assignment_cents AS cents
      FROM license_assignments la
      JOIN users u ON u.id = la.user_id
      JOIN access_tiers t ON t.id = la.tier_id
      WHERE la.tool_id = ${CLAUDE_CONSOLE_TOOL_ID}
        AND la.status = 'active'
        AND (
          la.workspace IN (
            SELECT name FROM anthropic_workspaces WHERE deprecated_at IS NOT NULL
          )
          OR la.id IN (${sql.join(
            EXPLICIT_EXTRA_ASSIGNMENT_IDS.map((id) => sql`${id}`),
            sql`, `,
          )})
        )
      ORDER BY la.id
    `)
  ).rows as {
    id: number;
    email: string;
    tier: string;
    workspace: string | null;
    cents: number;
  }[];

  const releasedCents = rows.reduce((sum, r) => sum + r.cents, 0);

  console.log(
    `${rows.length} active Claude Console assignment(s) on deprecated pooled ` +
      `workspaces, carrying $${(releasedCents / 100).toFixed(2)}/month of allowance.`,
  );
  console.log(`Revocation date: ${REVOCATION_DATE.toISOString().slice(0, 10)}`);
  console.log(`Assignment ids: ${rows.map((r) => r.id).join(" ")}`);

  const survivors = (
    await db.execute(sql`
      SELECT la.id, u.email, t.name AS tier
      FROM license_assignments la
      JOIN users u ON u.id = la.user_id
      JOIN access_tiers t ON t.id = la.tier_id
      WHERE la.tool_id = ${CLAUDE_CONSOLE_TOOL_ID}
        AND la.status = 'active'
        AND la.id NOT IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)})
      ORDER BY la.id
    `)
  ).rows as { id: number; email: string; tier: string }[];

  console.log(
    `\nSurviving: ${survivors.map((sv) => `${sv.id} ${sv.email} (${sv.tier})`).join(", ")}`,
  );

  if (!commit) {
    console.log("\nDry run — nothing written. Re-run with --commit to apply.");
    return;
  }

  let revoked = 0;
  let noop = 0;
  for (const row of rows) {
    const result = await revokeLicenseCore(
      uiContext(actorId),
      { id: row.id, revokedAt: REVOCATION_DATE },
    );
    if (!result.ok) {
      console.error(`  ${row.id} ${row.email}: FAILED — ${result.error}`);
      continue;
    }
    if (result.noop) noop++;
    else revoked++;
  }

  console.log(`\nRevoked ${revoked}, already inactive ${noop}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
