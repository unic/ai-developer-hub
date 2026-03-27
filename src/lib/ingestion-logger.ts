import "server-only";

import { db } from "@/lib/db";
import { ingestionLog } from "@/lib/db/schema";

export interface LogIngestionParams {
  filename?: string | null;
  vendor?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  amountCents?: number | null;
  outcome: "success" | "failed" | "filtered";
  errorMessage?: string | null;
  channel: "manual" | "api" | "bulk";
  blobPathname?: string | null;
  linkedInvoiceId?: number | null;
  uploadedBy?: number | null;
}

export async function logIngestionAttempt(params: LogIngestionParams) {
  await db.insert(ingestionLog).values({
    filename: params.filename ?? null,
    vendor: params.vendor ?? null,
    invoiceNumber: params.invoiceNumber ?? null,
    invoiceDate: params.invoiceDate ?? null,
    amountCents: params.amountCents ?? null,
    outcome: params.outcome,
    errorMessage: params.errorMessage ?? null,
    channel: params.channel,
    blobPathname: params.blobPathname ?? null,
    linkedInvoiceId: params.linkedInvoiceId ?? null,
    uploadedBy: params.uploadedBy ?? null,
  });
}
