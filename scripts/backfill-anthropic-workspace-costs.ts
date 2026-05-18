/**
 * One-off backfill for per-day workspace costs after fixing the sync bug.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/backfill-anthropic-workspace-costs.ts [YYYY-MM-DD]
 *
 * Default start date is 6 months back (matches the dashboard's sparkline range).
 */

import { run } from "../src/lib/sync/sources/anthropic-workspace";

async function main() {
  const arg = process.argv[2];
  let startDate: Date;

  if (arg) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
      console.error(`Invalid date: ${arg} (expected YYYY-MM-DD)`);
      process.exit(1);
    }
    startDate = new Date(`${arg}T00:00:00Z`);
  } else {
    const now = new Date();
    startDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)
    );
  }

  console.log(
    `Backfilling anthropic_workspace_costs from ${startDate.toISOString().slice(0, 10)}…`
  );

  const result = await run(undefined, { backfillStartDate: startDate });
  console.log("Result:", result);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
