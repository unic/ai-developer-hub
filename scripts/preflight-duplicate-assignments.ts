/**
 * Pre-flight for migration 0030 (043-mcp-write-tools). READ-ONLY — writes nothing,
 * has no --apply mode, and is safe to run against production.
 *
 * WHY THIS EXISTS
 *
 * 0030 adds `license_assignments_one_active_idx`, a partial unique index enforcing
 * "at most one ACTIVE assignment per (user, tool)". The app has always assumed that
 * invariant but nothing enforced it, so violating rows may already exist —
 * `assignLicense` deactivates-then-inserts inside a transaction, which under READ
 * COMMITTED does not stop two concurrent callers from both seeing "no active row"
 * and both inserting.
 *
 * `CREATE UNIQUE INDEX` aborts on existing violations, so 0030 contains a DO block
 * that remediates first: it keeps one row per (user, tool) and collapses the rest to
 * zero-duration inactive rows. That is a DATA MUTATION, and it moves reported spend
 * downward (a double-counted seat stops being double-counted). Run this first so you
 * know what the migration is about to change instead of discovering it afterwards.
 *
 * Every duplicate this reports is a seat that has been counted twice in every
 * aggregation summing license_assignments.cost_at_assignment_cents — the dashboard
 * KPIs, /reports, budget expected spend and the forecast burn-up — since it was
 * created. The migration corrects that, but the correction changes numbers that may
 * already have been reported, which is worth knowing in advance.
 *
 * The ORDER BY below is kept deliberately identical to the migration's, so the
 * KEEP/REVOKE column is what 0030 will actually do — not an approximation. If you
 * change one, change both.
 *
 * Note the survivor rule is EARLIEST assigned_at, not highest id: verified against
 * real data where id 391 carried an earlier assigned_at than id 102 for the same
 * (user, tool), because the license-request approval flow inserts backdated rows.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/preflight-duplicate-assignments.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";

/** Mirrors migration 0030's survivor rule exactly. */
const RANKED = `
  SELECT la.id,
         la.user_id,
         la.tool_id,
         la.tier_id,
         la.cost_at_assignment_cents AS cents,
         la.assigned_at,
         row_number() OVER (
           PARTITION BY la.user_id, la.tool_id
           ORDER BY la.assigned_at ASC, la.id ASC
         ) AS rn,
         count(*) OVER (PARTITION BY la.user_id, la.tool_id) AS group_size
  FROM license_assignments la
  WHERE la.status = 'active'
`;

async function main() {
  // The unpooled endpoint is preferred for consistency with db:migrate, but either
  // works — this only reads.
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL (or DATABASE_URL_UNPOOLED) is not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, max: 1 });

  try {
    const endpoint = url.match(/ep-[a-z0-9-]+/)?.[0] ?? "unknown";
    console.log(`endpoint: ${endpoint}`);

    const migrated = await pool.query(
      `SELECT 1 FROM pg_indexes
       WHERE tablename = 'license_assignments'
         AND indexname = 'license_assignments_one_active_idx'`,
    );
    if (migrated.rowCount) {
      console.log(
        "\nMigration 0030 is ALREADY APPLIED here — the unique index exists, so no\n" +
          "duplicate can remain. Nothing to pre-flight.",
      );
      return;
    }

    const { rows } = await pool.query(`
      WITH ranked AS (${RANKED})
      SELECT u.email,
             t.name  AS tool,
             ti.name AS tier,
             r.id    AS assignment_id,
             r.cents,
             to_char(r.assigned_at, 'YYYY-MM-DD') AS assigned,
             CASE WHEN r.rn = 1 THEN 'KEEP' ELSE 'will be revoked' END AS outcome
      FROM ranked r
      JOIN users u        ON u.id  = r.user_id
      JOIN ai_tools t     ON t.id  = r.tool_id
      JOIN access_tiers ti ON ti.id = r.tier_id
      WHERE r.group_size > 1
      ORDER BY u.email, r.rn
    `);

    if (rows.length === 0) {
      console.log(
        "\nNo duplicate ACTIVE assignments.\n" +
          "Migration 0030's remediation block is a no-op here: it will mutate no rows,\n" +
          "reported spend will not move, and the migration is purely additive.",
      );
      return;
    }

    console.log(
      `\n${rows.length} row(s) across the affected (user, tool) pairs — ` +
        "'will be revoked' rows are what 0030 collapses:",
    );
    console.table(rows);

    const [{ pairs, reduction }] = (
      await pool.query(`
        WITH ranked AS (${RANKED})
        SELECT count(DISTINCT (user_id, tool_id))::int AS pairs,
               COALESCE(sum(cents) FILTER (WHERE rn > 1), 0)::int AS reduction
        FROM ranked
        WHERE group_size > 1
      `)
    ).rows;

    console.log(
      `\n${pairs} (user, tool) pair(s) affected.\n` +
        `Org-wide ACTIVE monthly spend will drop by ${reduction} cents ` +
        `($${(reduction / 100).toFixed(2)}) when 0030 runs.\n` +
        "That is a correction of double-counting, not a loss of licences — but it will\n" +
        "change dashboard, /reports and budget figures, so note the amount before you\n" +
        "deploy rather than explaining it afterwards.",
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
