import { eq, like, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { invoices } from "@/lib/db/schema";
import {
  anthropicInvoicePrefix,
  isTruncatedPrefix,
  sameCanonicalInvoiceNumber,
} from "@/lib/invoice-number";
import { vendorsEquivalent } from "@/lib/vendor-identity";

export interface InvoiceIdentity {
  id: number;
  invoiceNumber: string;
  invoiceDate: string;
  amountCents: number;
  vendor: string | null;
  linkedBilledCostId: number | null;
}

export interface IncomingInvoice {
  invoiceNumber: string;
  invoiceDate?: string | null;
  amountCents?: number | null;
  vendor?: string | null;
}

/** Truncated-prefix conflicts need a real vendor, date, and amount. Empty or sentinel values do not count. */
function hasReceiptFingerprint(incoming: IncomingInvoice): boolean {
  return (
    typeof incoming.invoiceDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(incoming.invoiceDate) &&
    typeof incoming.amountCents === "number" &&
    incoming.amountCents > 0 &&
    typeof incoming.vendor === "string" &&
    incoming.vendor.trim() !== ""
  );
}

/**
 * Pick the archived invoice that conflicts with an incoming receipt.
 *
 * 1. The full canonical number matches (dash and space are the same number).
 * 2. A stored bare prefix is the truncation of this number AND the vendor,
 *    date, and amount match. A future parser that drops the suffix again then
 *    cannot treat two different receipts as one invoice: different amounts or
 *    dates are not a conflict. The same receipt posted twice still is.
 */
export function chooseConflict(
  candidates: InvoiceIdentity[],
  incoming: IncomingInvoice,
): InvoiceIdentity | undefined {
  const exact = candidates.find(
    (row) => row.invoiceNumber === incoming.invoiceNumber,
  );
  if (exact) return exact;

  const canonical = candidates.find((row) =>
    sameCanonicalInvoiceNumber(row.invoiceNumber, incoming.invoiceNumber),
  );
  if (canonical) return canonical;

  if (!hasReceiptFingerprint(incoming)) return undefined;

  return candidates.find(
    (row) =>
      isTruncatedPrefix(row.invoiceNumber, incoming.invoiceNumber) &&
      row.invoiceDate === incoming.invoiceDate &&
      row.amountCents === incoming.amountCents &&
      vendorsEquivalent(row.vendor, incoming.vendor),
  );
}

function toIdentity(row: {
  id: number;
  invoiceNumber: string;
  invoiceDate: string;
  amountCents: number;
  vendor: string | null;
  linkedBilledCostId: number | null;
}): InvoiceIdentity {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: row.invoiceDate,
    amountCents: row.amountCents,
    vendor: row.vendor,
    linkedBilledCostId: row.linkedBilledCostId,
  };
}

/**
 * Duplicate check for ingest. Keys on the full invoice number, and also
 * rejects a re-post of a receipt previously stored as a truncated prefix
 * when vendor, date, and amount agree.
 */
export async function findInvoiceConflict(
  incoming: IncomingInvoice,
): Promise<InvoiceIdentity | undefined> {
  const exact = await db.query.invoices.findFirst({
    where: eq(invoices.invoiceNumber, incoming.invoiceNumber),
  });
  if (exact) return toIdentity(exact);

  const prefix = anthropicInvoicePrefix(incoming.invoiceNumber);
  if (!prefix) return undefined;

  const related = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      amountCents: invoices.amountCents,
      vendor: invoices.vendor,
      linkedBilledCostId: invoices.linkedBilledCostId,
    })
    .from(invoices)
    .where(
      or(
        eq(invoices.invoiceNumber, prefix),
        like(invoices.invoiceNumber, `${prefix} %`),
        like(invoices.invoiceNumber, `${prefix}-%`),
        // No separator, e.g. "K6EV5YRI0095". Migration 0034 does not rewrite
        // that shape, and a re-ingest now stores "K6EV5YRI 0095".
        sql`${invoices.invoiceNumber} ~* ${`^${prefix}[0-9]+$`}`,
      ),
    );

  return chooseConflict(related.map(toIdentity), incoming);
}
