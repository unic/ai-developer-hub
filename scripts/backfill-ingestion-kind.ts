/**
 * One-off backfill for the 034-ingestion-types-distinction expand/migrate step.
 *
 * The additive migration (0023) defaulted every existing ingestion_log row to
 * kind='invoice'. This script reclassifies the license-request rows that the
 * pre-034 code logged into the same table (via the invoice_number / form
 * overload) and populates the new `details`, `label`, `source_type` and
 * `entity_*` columns for ALL rows so the new read path renders correctly.
 *
 * Classification signal (robust): a row is a license request iff its
 * invoice_number matches an existing license_requests.form_response_id — form
 * response IDs are GUID-like and won't collide with real invoice numbers.
 *
 * Idempotent: safe to re-run. Dry-run by default; pass --apply to write.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/backfill-ingestion-kind.ts          # dry run
 *   pnpm tsx --env-file=.env.local scripts/backfill-ingestion-kind.ts --apply  # write
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq } from "drizzle-orm";
import {
  ingestionLog,
  licenseRequests,
  aiTools,
  accessTiers,
} from "../src/lib/db/schema";
import { buildIngestionLabel } from "../src/lib/ingestion/labels";
import type { IngestionDetails } from "../src/types";

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  // Map form_response_id -> enriched license request (with tool/tier names).
  const lrRows = await db
    .select({
      id: licenseRequests.id,
      formResponseId: licenseRequests.formResponseId,
      requesterEmail: licenseRequests.requesterEmail,
      requesterName: licenseRequests.requesterName,
      toolName: aiTools.name,
      tierName: accessTiers.name,
    })
    .from(licenseRequests)
    .leftJoin(aiTools, eq(licenseRequests.requestedToolId, aiTools.id))
    .leftJoin(accessTiers, eq(licenseRequests.requestedTierId, accessTiers.id));

  const byFormId = new Map(lrRows.map((r) => [r.formResponseId, r]));

  const rows = await db
    .select({
      id: ingestionLog.id,
      outcome: ingestionLog.outcome,
      filename: ingestionLog.filename,
      vendor: ingestionLog.vendor,
      invoiceNumber: ingestionLog.invoiceNumber,
      invoiceDate: ingestionLog.invoiceDate,
      amountCents: ingestionLog.amountCents,
      blobPathname: ingestionLog.blobPathname,
      linkedInvoiceId: ingestionLog.linkedInvoiceId,
    })
    .from(ingestionLog);

  const counts = { invoice: 0, license_request: 0, normalizedDedup: 0 };

  for (const row of rows) {
    const lr = row.invoiceNumber ? byFormId.get(row.invoiceNumber) : undefined;

    let kind: "invoice" | "license_request";
    let sourceType: "invoice_pdf" | "ms_forms_license_request";
    let details: IngestionDetails;
    let entityType: string | null;
    let entityId: number | null;
    let outcome = row.outcome;

    if (lr) {
      kind = "license_request";
      sourceType = "ms_forms_license_request";
      // Pre-034 used outcome='filtered' to mean an idempotent dedup replay.
      const deduped = row.outcome === "filtered";
      if (deduped) {
        outcome = "success"; // Q3: dedup is a successful, idempotent outcome.
        counts.normalizedDedup++;
      }
      details = {
        kind: "license_request",
        formResponseId: lr.formResponseId,
        requesterEmail: lr.requesterEmail,
        requesterName: lr.requesterName,
        toolName: lr.toolName,
        tierName: lr.tierName,
        deduped,
      };
      entityType = "license_request";
      entityId = lr.id;
      counts.license_request++;
    } else {
      kind = "invoice";
      sourceType = "invoice_pdf";
      details = {
        kind: "invoice",
        vendor: row.vendor,
        invoiceNumber: row.invoiceNumber,
        invoiceDate: row.invoiceDate ? String(row.invoiceDate) : null,
        amountCents: row.amountCents,
        filename: row.filename,
        blobPathname: row.blobPathname,
      };
      entityType = row.linkedInvoiceId != null ? "invoice" : null;
      entityId = row.linkedInvoiceId;
      counts.invoice++;
    }

    if (apply) {
      await db
        .update(ingestionLog)
        .set({
          kind,
          sourceType,
          outcome,
          label: buildIngestionLabel(details),
          details,
          entityType,
          entityId,
        })
        .where(eq(ingestionLog.id, row.id));
    }
  }

  console.log(
    `${apply ? "Applied" : "DRY RUN"} — total ${rows.length} rows:`,
    counts,
  );
  if (!apply) console.log("Re-run with --apply to write changes.");

  await pool.end();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
