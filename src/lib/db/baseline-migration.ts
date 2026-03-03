/**
 * One-time script to baseline the Drizzle migration tracking table.
 *
 * The database was originally set up via `db:push`, so there's no
 * `__drizzle_migrations` table. This script creates it and marks
 * migration 0000 as already applied so `db:migrate` only runs
 * new migrations going forward.
 *
 * Usage: npx tsx src/lib/db/baseline-migration.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createHash } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Pool } from "@neondatabase/serverless";

async function baseline() {
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    console.error("DATABASE_URL_UNPOOLED is not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, max: 1 });

  // Read the journal to get migration entries
  const journalPath = resolve("src/lib/db/migrations/meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf-8"));

  // Create the drizzle schema and migrations table (same as drizzle-orm does)
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  // Check if any migrations are already recorded
  const existing = await pool.query(
    `SELECT id FROM "drizzle"."__drizzle_migrations" LIMIT 1`
  );
  if (existing.rows.length > 0) {
    console.log("Migration table already has entries — skipping baseline.");
    await pool.end();
    return;
  }

  // Mark migration 0000 as applied (it was applied via db:push)
  const entry = journal.entries[0];
  const migrationPath = resolve(
    `src/lib/db/migrations/${entry.tag}.sql`
  );
  const sql = readFileSync(migrationPath, "utf-8");
  const hash = createHash("sha256").update(sql).digest("hex");

  await pool.query(
    `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)`,
    [hash, entry.when]
  );

  console.log(`Baselined migration: ${entry.tag} (hash: ${hash.slice(0, 12)}...)`);
  console.log("You can now run `pnpm db:migrate` to apply new migrations.");

  await pool.end();
}

baseline().catch((err) => {
  console.error("Baseline failed:", err);
  process.exit(1);
});
