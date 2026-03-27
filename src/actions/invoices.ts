"use server";

import { db } from "@/lib/db";
import {
  invoices,
  billedCosts,
} from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getR2Client, getR2Bucket } from "@/lib/r2-client";
import { requireAdmin } from "@/lib/auth-helpers";
import { z } from "zod";
import { createInvoiceSchema } from "@/lib/validators";
import type { CreateInvoiceInput, InvoiceExtractionResult } from "@/lib/validators";
import { extractInvoiceFields as extractFromLib } from "@/lib/invoice-extraction";
import { recordCreation } from "@/actions/history";
import { logIngestionAttempt } from "@/lib/ingestion-logger";
import { findActivePeriodForDate } from "@/lib/budget-utils";
import { evaluateIngestionFilters } from "@/lib/ingestion-filters";
import type { ActionResult } from "@/types";

export async function extractInvoiceFieldsAction(
  input: { objectKey: string }
): Promise<ActionResult<InvoiceExtractionResult>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  return extractFromLib(input);
}

// T001: Check single invoice duplicate
export async function checkInvoiceDuplicate(invoiceNumber: string): Promise<
  ActionResult<{
    isDuplicate: boolean;
    existingInvoice?: {
      id: number;
      invoiceNumber: string;
      invoiceDate: string;
      amountCents: number;
      vendor: string | null;
      linkedBilledCostId: number | null;
    };
  }>
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const existing = await db.query.invoices.findFirst({
    where: eq(invoices.invoiceNumber, invoiceNumber),
  });

  if (!existing) {
    return { success: true, data: { isDuplicate: false } };
  }

  return {
    success: true,
    data: {
      isDuplicate: true,
      existingInvoice: {
        id: existing.id,
        invoiceNumber: existing.invoiceNumber,
        invoiceDate: existing.invoiceDate,
        amountCents: existing.amountCents,
        vendor: existing.vendor,
        linkedBilledCostId: existing.linkedBilledCostId,
      },
    },
  };
}

// T002: Batch check multiple invoice numbers
export async function checkBulkDuplicates(invoiceNumbers: string[]): Promise<
  ActionResult<{
    duplicates: Record<
      string,
      { id: number; invoiceDate: string; amountCents: number; vendor: string | null }
    >;
  }>
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  if (invoiceNumbers.length === 0) {
    return { success: true, data: { duplicates: {} } };
  }

  const existing = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      amountCents: invoices.amountCents,
      vendor: invoices.vendor,
    })
    .from(invoices)
    .where(inArray(invoices.invoiceNumber, invoiceNumbers));

  const duplicates: Record<
    string,
    { id: number; invoiceDate: string; amountCents: number; vendor: string | null }
  > = {};
  for (const row of existing) {
    if (!duplicates[row.invoiceNumber]) {
      duplicates[row.invoiceNumber] = {
        id: row.id,
        invoiceDate: row.invoiceDate,
        amountCents: row.amountCents,
        vendor: row.vendor,
      };
    }
  }

  return { success: true, data: { duplicates } };
}

// T003: Best-effort R2 blob cleanup (internal only)
async function cleanupBlobInternal(blobPathname: string): Promise<void> {
  if (!blobPathname.startsWith("invoices/")) return;
  try {
    await getR2Client().send(
      new DeleteObjectCommand({ Bucket: getR2Bucket(), Key: blobPathname })
    );
  } catch {
    // Best-effort — swallow errors
  }
}

// Authenticated wrapper for client-callable cleanup
export async function cleanupBlob(blobPathname: string): Promise<void> {
  const admin = await requireAdmin();
  if (!admin) return;
  await cleanupBlobInternal(blobPathname);
}

async function insertBilledCostDirect(params: {
  periodId: number;
  amountCents: number;
  invoiceDate: string;
  invoiceNumber: string;
  vendor: string | null | undefined;
  uploadedById: number;
}): Promise<number> {
  const { periodId, amountCents, invoiceDate, invoiceNumber, vendor, uploadedById } = params;
  const description = vendor
    ? `Invoice ${invoiceNumber} — ${vendor}`
    : `Invoice ${invoiceNumber}`;

  const [created] = await db
    .insert(billedCosts)
    .values({
      periodId,
      amountCents,
      invoiceDate,
      description,
      vendorReference: invoiceNumber,
    })
    .returning({ id: billedCosts.id });

  await recordCreation("billed_cost", created.id, uploadedById);
  return created.id;
}

// T005: Overwrite existing invoice (update-in-place)
type OverwriteInvoiceInput = {
  existingInvoiceId: number;
  invoiceNumber: string;
  invoiceDate: string;
  amountCents: number;
  vendor?: string;
  blobUrl: string;
  blobPathname: string;
};

type OverwriteResult =
  | { success: true; data: { id: number }; linkedPeriodLabel?: string; linkWarning?: string }
  | { success: false; error: string };

const overwriteInvoiceSchema = createInvoiceSchema.extend({
  existingInvoiceId: z.number().int().positive(),
});

export async function overwriteInvoice(
  input: OverwriteInvoiceInput
): Promise<OverwriteResult> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = overwriteInvoiceSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Validation failed: " + parsed.error.issues.map(i => i.message).join(", ") };
  }

  const { existingInvoiceId, invoiceNumber, invoiceDate, amountCents, vendor, blobUrl, blobPathname } = parsed.data;

  // Fetch existing invoice
  const existing = await db.query.invoices.findFirst({
    where: eq(invoices.id, existingInvoiceId),
  });
  if (!existing) {
    return { success: false, error: "Existing invoice not found" };
  }

  const oldBlobPathname = existing.blobPathname;
  const oldLinkedBilledCostId = existing.linkedBilledCostId;

  // Perform all DB mutations atomically
  let linkedPeriodLabel: string | undefined;
  let linkWarning: string | undefined;
  const period = await findActivePeriodForDate(invoiceDate);

  await db.transaction(async (tx) => {
    // Update invoice row
    await tx
      .update(invoices)
      .set({
        invoiceNumber,
        invoiceDate,
        amountCents,
        vendor: vendor ?? null,
        blobUrl,
        blobPathname,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, existingInvoiceId));

    // Handle linked billed cost
    if (oldLinkedBilledCostId) {
      const oldCost = await tx.query.billedCosts.findFirst({
        where: eq(billedCosts.id, oldLinkedBilledCostId),
      });

      if (period && oldCost && oldCost.periodId === period.id) {
        // Same period — update in place
        const description = vendor
          ? `Invoice ${invoiceNumber} — ${vendor}`
          : `Invoice ${invoiceNumber}`;
        await tx
          .update(billedCosts)
          .set({
            amountCents,
            invoiceDate,
            description,
            vendorReference: invoiceNumber,
            updatedAt: new Date(),
          })
          .where(eq(billedCosts.id, oldLinkedBilledCostId));
        linkedPeriodLabel = period.periodLabel;
      } else if (period) {
        // Different period — delete old, create new
        await tx.delete(billedCosts).where(eq(billedCosts.id, oldLinkedBilledCostId));
        const description = vendor
          ? `Invoice ${invoiceNumber} — ${vendor}`
          : `Invoice ${invoiceNumber}`;
        const [created] = await tx
          .insert(billedCosts)
          .values({
            periodId: period.id,
            amountCents,
            invoiceDate,
            description,
            vendorReference: invoiceNumber,
          })
          .returning({ id: billedCosts.id });
        await tx
          .update(invoices)
          .set({ linkedBilledCostId: created.id })
          .where(eq(invoices.id, existingInvoiceId));
        linkedPeriodLabel = period.periodLabel;
      } else {
        // No matching period — remove link
        await tx.delete(billedCosts).where(eq(billedCosts.id, oldLinkedBilledCostId));
        await tx
          .update(invoices)
          .set({ linkedBilledCostId: null })
          .where(eq(invoices.id, existingInvoiceId));
        linkWarning = "No active budget period covers this invoice date. Previous budget link was removed.";
      }
    } else if (period) {
      // No existing billed cost — attempt auto-link
      const description = vendor
        ? `Invoice ${invoiceNumber} — ${vendor}`
        : `Invoice ${invoiceNumber}`;
      const [created] = await tx
        .insert(billedCosts)
        .values({
          periodId: period.id,
          amountCents,
          invoiceDate,
          description,
          vendorReference: invoiceNumber,
        })
        .returning({ id: billedCosts.id });
      await tx
        .update(invoices)
        .set({ linkedBilledCostId: created.id })
        .where(eq(invoices.id, existingInvoiceId));
      linkedPeriodLabel = period.periodLabel;
    } else {
      linkWarning = "No active budget period covers this invoice date.";
    }
  });

  // R2 blob cleanup outside transaction (best-effort)
  if (oldBlobPathname !== blobPathname) {
    await cleanupBlobInternal(oldBlobPathname);
  }

  revalidatePath("/invoices");

  return {
    success: true,
    data: { id: existingInvoiceId },
    linkedPeriodLabel,
    linkWarning,
  };
}

type SaveInvoiceResult =
  | { success: true; data: { id: number }; linkedPeriodLabel?: string; linkWarning?: string; filterWarning?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export async function saveInvoice(
  input: CreateInvoiceInput,
  channel: "manual" | "bulk" = "manual"
): Promise<SaveInvoiceResult> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = createInvoiceSchema.safeParse(input);
  if (!parsed.success) {
    await logIngestionAttempt({
      vendor: input.vendor ?? null,
      invoiceNumber: input.invoiceNumber ?? null,
      outcome: "failed",
      errorMessage: "Validation failed",
      channel,
      uploadedBy: Number(admin.id),
    });
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { invoiceNumber, invoiceDate, amountCents, vendor, blobUrl, blobPathname } = parsed.data;

  // Evaluate ingestion filters before insert to set filteredOut in one query
  const filterResult = await evaluateIngestionFilters({
    vendor: vendor ?? null,
    invoiceNumber,
  });

  let newId: number;
  try {
    const [created] = await db
      .insert(invoices)
      .values({
        invoiceNumber,
        invoiceDate,
        amountCents,
        vendor: vendor ?? null,
        blobUrl,
        blobPathname,
        uploadedBy: Number(admin.id),
        filteredOut: filterResult.filteredOut,
      })
      .returning({ id: invoices.id });
    newId = created.id;
  } catch (err) {
    // Orphan cleanup: delete the uploaded R2 object if DB write fails
    try {
      await getR2Client().send(new DeleteObjectCommand({ Bucket: getR2Bucket(), Key: blobPathname }));
    } catch {
      // Best-effort cleanup — ignore secondary failure
    }
    const message = err instanceof Error ? err.message : "Database error";
    await logIngestionAttempt({
      vendor: vendor ?? null,
      invoiceNumber,
      invoiceDate,
      amountCents,
      outcome: "failed",
      errorMessage: `Failed to save invoice: ${message}`,
      channel,
      blobPathname,
      uploadedBy: Number(admin.id),
    });
    return { success: false, error: `Failed to save invoice: ${message}` };
  }

  await recordCreation("invoice", newId, Number(admin.id));

  if (filterResult.filteredOut) {
    await logIngestionAttempt({
      vendor: vendor ?? null,
      invoiceNumber,
      invoiceDate,
      amountCents,
      outcome: "filtered",
      errorMessage: filterResult.reason,
      channel,
      blobPathname,
      linkedInvoiceId: newId,
      uploadedBy: Number(admin.id),
    });

    revalidatePath("/invoices");
    return {
      success: true,
      data: { id: newId },
      filterWarning: filterResult.reason ?? "Invoice was filtered by an ingestion rule.",
    };
  }

  await logIngestionAttempt({
    vendor: vendor ?? null,
    invoiceNumber,
    invoiceDate,
    amountCents,
    outcome: "success",
    channel,
    blobPathname,
    linkedInvoiceId: newId,
    uploadedBy: Number(admin.id),
  });

  // Auto-link to budget period
  const period = await findActivePeriodForDate(invoiceDate);
  let linkedPeriodLabel: string | undefined;
  let linkWarning: string | undefined;

  if (period) {
    try {
      const costId = await insertBilledCostDirect({
        periodId: period.id,
        amountCents,
        invoiceDate,
        invoiceNumber,
        vendor,
        uploadedById: Number(admin.id),
      });
      await db
        .update(invoices)
        .set({ linkedBilledCostId: costId })
        .where(eq(invoices.id, newId));
      linkedPeriodLabel = period.periodLabel;
    } catch {
      linkWarning =
        "Invoice was saved, but automatic linking to the budget period failed. You may need to link it manually.";
    }
  } else {
    linkWarning = "No active budget period covers this invoice date.";
  }

  revalidatePath("/invoices");

  return {
    success: true,
    data: { id: newId },
    linkedPeriodLabel,
    linkWarning,
  };
}

export type BulkSaveOutcome = {
  filename: string;
  invoiceId?: number;
  linkedPeriodLabel?: string;
  linkWarning?: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
};

export async function saveBulkInvoices(
  inputs: Array<CreateInvoiceInput & { filename: string; skip?: boolean; skipReason?: string }>
): Promise<ActionResult<BulkSaveOutcome[]>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const outcomes: BulkSaveOutcome[] = [];

  for (const { filename, skip, skipReason, ...invoiceInput } of inputs) {
    if (skip) {
      await cleanupBlob(invoiceInput.blobPathname);
      await logIngestionAttempt({
        filename,
        vendor: invoiceInput.vendor ?? null,
        invoiceNumber: invoiceInput.invoiceNumber ?? null,
        outcome: "failed",
        errorMessage: skipReason ?? "Skipped by user",
        channel: "bulk",
        uploadedBy: Number(admin.id),
      });
      outcomes.push({ filename, skipped: true, skipReason });
      continue;
    }

    try {
      const result = await saveInvoice(invoiceInput, "bulk");
      if (result.success) {
        outcomes.push({
          filename,
          invoiceId: result.data.id,
          linkedPeriodLabel: result.linkedPeriodLabel,
          linkWarning: result.linkWarning,
        });
      } else {
        outcomes.push({ filename, error: result.error });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await logIngestionAttempt({
        filename,
        vendor: invoiceInput.vendor ?? null,
        invoiceNumber: invoiceInput.invoiceNumber ?? null,
        outcome: "failed",
        errorMessage: message,
        channel: "bulk",
        uploadedBy: Number(admin.id),
      });
      outcomes.push({ filename, error: message });
    }
  }

  revalidatePath("/invoices");
  return { success: true, data: outcomes };
}
