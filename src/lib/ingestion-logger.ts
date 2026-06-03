import "server-only";

import { db } from "@/lib/db";
import { ingestionLog } from "@/lib/db/schema";
import { buildIngestionLabel } from "@/lib/ingestion/labels";
import type {
  IngestionChannel,
  IngestionDetails,
  IngestionKind,
  IngestionOutcome,
  IngestionSourceType,
} from "@/types";

export interface LogIngestionParams {
  kind: IngestionKind;
  sourceType?: IngestionSourceType | null;
  outcome: IngestionOutcome;
  channel: IngestionChannel;
  details: IngestionDetails;
  /** Polymorphic drill-through target — NOT a DB foreign key. */
  entity?: { type: string; id: number } | null;
  errorMessage?: string | null;
  uploadedBy?: number | null;
}

/**
 * Canonical, discriminated ingestion logger (034). Writes the new
 * kind/source/label/details/entity columns and — during the expand/migrate
 * window — dual-writes the deprecated invoice columns for `kind: "invoice"`
 * so the legacy read path keeps working until P3 switches it over. The
 * deprecated columns (and this dual-write) are removed in P4.
 */
export async function logIngestion(params: LogIngestionParams) {
  const { details } = params;

  // Legacy dual-write: only invoices ever populated these columns. License
  // requests deliberately leave them null (this is what removes the unsafe
  // linked_invoice_id FK abuse from the old code path).
  const legacy =
    details.kind === "invoice"
      ? {
          filename: details.filename ?? null,
          vendor: details.vendor ?? null,
          invoiceNumber: details.invoiceNumber ?? null,
          invoiceDate: details.invoiceDate ?? null,
          amountCents: details.amountCents ?? null,
          blobPathname: details.blobPathname ?? null,
          linkedInvoiceId:
            params.entity?.type === "invoice" ? params.entity.id : null,
        }
      : {};

  await db.insert(ingestionLog).values({
    kind: params.kind,
    sourceType: params.sourceType ?? null,
    outcome: params.outcome,
    channel: params.channel,
    label: buildIngestionLabel(details),
    details,
    entityType: params.entity?.type ?? null,
    entityId: params.entity?.id ?? null,
    errorMessage: params.errorMessage ?? null,
    uploadedBy: params.uploadedBy ?? null,
    ...legacy,
  });
}

/**
 * @deprecated Invoice-shaped shim retained so existing invoice call sites keep
 * working during the migration. Maps the old params onto {@link logIngestion}
 * with `kind: "invoice"`. New code should call `logIngestion` directly.
 * Removed in P4 alongside the deprecated columns.
 */
export interface LegacyLogIngestionParams {
  filename?: string | null;
  vendor?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  amountCents?: number | null;
  outcome: IngestionOutcome;
  errorMessage?: string | null;
  channel: IngestionChannel;
  blobPathname?: string | null;
  linkedInvoiceId?: number | null;
  uploadedBy?: number | null;
}

export async function logIngestionAttempt(params: LegacyLogIngestionParams) {
  await logIngestion({
    kind: "invoice",
    sourceType: "invoice_pdf",
    outcome: params.outcome,
    channel: params.channel,
    errorMessage: params.errorMessage,
    uploadedBy: params.uploadedBy,
    entity:
      params.linkedInvoiceId != null
        ? { type: "invoice", id: params.linkedInvoiceId }
        : null,
    details: {
      kind: "invoice",
      filename: params.filename ?? null,
      vendor: params.vendor ?? null,
      invoiceNumber: params.invoiceNumber ?? null,
      invoiceDate: params.invoiceDate ?? null,
      amountCents: params.amountCents ?? null,
      blobPathname: params.blobPathname ?? null,
    },
  });
}
