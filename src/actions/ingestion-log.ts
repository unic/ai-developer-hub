"use server";

import { db } from "@/lib/db";
import { ingestionLog, users } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-helpers";

export interface IngestionLogRow {
  id: number;
  filename: string | null;
  vendor: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amountCents: number | null;
  outcome: "success" | "failed" | "filtered";
  errorMessage: string | null;
  channel: "manual" | "api" | "bulk";
  blobPathname: string | null;
  linkedInvoiceId: number | null;
  uploaderName: string | null;
  createdAt: string;
}

export async function getIngestionHistory(): Promise<
  { success: true; data: IngestionLogRow[] } | { success: false; error: string }
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const rows = await db
    .select({
      id: ingestionLog.id,
      filename: ingestionLog.filename,
      vendor: ingestionLog.vendor,
      invoiceNumber: ingestionLog.invoiceNumber,
      invoiceDate: ingestionLog.invoiceDate,
      amountCents: ingestionLog.amountCents,
      outcome: ingestionLog.outcome,
      errorMessage: ingestionLog.errorMessage,
      channel: ingestionLog.channel,
      blobPathname: ingestionLog.blobPathname,
      linkedInvoiceId: ingestionLog.linkedInvoiceId,
      uploaderName: users.name,
      createdAt: ingestionLog.createdAt,
    })
    .from(ingestionLog)
    .leftJoin(users, eq(ingestionLog.uploadedBy, users.id))
    .orderBy(desc(ingestionLog.createdAt))
    .limit(500);

  return {
    success: true,
    data: rows.map((r) => ({
      ...r,
      invoiceDate: r.invoiceDate ? String(r.invoiceDate) : null,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
