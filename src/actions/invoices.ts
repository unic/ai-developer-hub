"use server";

import { db } from "@/lib/db";
import { invoices } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { r2Client, R2_BUCKET } from "@/lib/r2-client";
import { requireAdmin } from "@/lib/auth-helpers";
import { createInvoiceSchema } from "@/lib/validators";
import type { CreateInvoiceInput, InvoiceExtractionResult } from "@/lib/validators";
import { extractInvoiceFields as extractFromLib } from "@/lib/invoice-extraction";
import { recordCreation } from "@/actions/history";
import type { ActionResult } from "@/types";

export async function extractInvoiceFieldsAction(
  input: { objectKey: string }
): Promise<ActionResult<InvoiceExtractionResult>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  return extractFromLib(input);
}

export async function saveInvoice(
  input: CreateInvoiceInput
): Promise<ActionResult<{ id: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = createInvoiceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { invoiceNumber, invoiceDate, amountCents, blobUrl, blobPathname } = parsed.data;

  // Soft duplicate check
  const existing = await db.query.invoices.findFirst({
    where: eq(invoices.invoiceNumber, invoiceNumber),
  });
  const isDuplicate = !!existing;

  let newId: number;
  try {
    const [created] = await db
      .insert(invoices)
      .values({
        invoiceNumber,
        invoiceDate,
        amountCents,
        blobUrl,
        blobPathname,
        uploadedBy: Number(admin.id),
      })
      .returning({ id: invoices.id });
    newId = created.id;
  } catch (err) {
    // Orphan cleanup: delete the uploaded R2 object if DB write fails
    try {
      await r2Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: blobPathname }));
    } catch {
      // Best-effort cleanup — ignore secondary failure
    }
    const message = err instanceof Error ? err.message : "Database error";
    return { success: false, error: `Failed to save invoice: ${message}` };
  }

  await recordCreation("invoice", newId, Number(admin.id));
  revalidatePath("/invoices");

  return {
    success: true,
    data: { id: newId },
    ...(isDuplicate ? { warning: "An invoice with this number already exists." } : {}),
  };
}
