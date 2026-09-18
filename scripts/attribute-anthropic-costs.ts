/**
 * One-off / maintenance re-attribution of billed workspace cost onto users.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/attribute-anthropic-costs.ts [YYYY-MM-DD] [YYYY-MM-DD]
 *
 * Defaults to the whole of the current year. Safe to re-run: the range is
 * cleared and recomputed from the rollup, which is itself derived from the
 * billed line items.
 */

import { attributeRange } from "../src/lib/sync/sources/anthropic-workspace";

async function main() {
  const year = new Date().getUTCFullYear();
  const start = process.argv[2] ?? `${year}-01-01`;
  const end = process.argv[3] ?? `${year}-12-31`;

  console.log(`Attributing billed cost from ${start} to ${end}…`);
  const written = await attributeRange(start, end);
  console.log(`Wrote ${written} attributed rows.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
