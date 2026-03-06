"use server";

import { db } from "@/lib/db";
import {
  invoices,
  billedCosts,
  budgetPeriods,
  annualBudgets,
} from "@/lib/db/schema";
import { eq, and, lte, gt, desc, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getR2Client, getR2Bucket } from "@/lib/r2-client";
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

// T003: Best-effort R2 blob cleanup
export async function cleanupBlob(blobPathname: string): Promise<void> {
  try {
    await getR2Client().send(
      new DeleteObjectCommand({ Bucket: getR2Bucket(), Key: blobPathname })
    );
  } catch {
    // Best-effort — swallow errors
  }
}

async function findActivePeriodForDate(
  invoiceDate: string
): Promise<{ id: number; periodLabel: string } | null> {
  const rows = await db
    .select({
      id: budgetPeriods.id,
      periodLabel: budgetPeriods.periodLabel,
    })
    .from(budgetPeriods)
    .innerJoin(annualBudgets, eq(budgetPeriods.budgetId, annualBudgets.id))
    .where(
      and(
        eq(annualBudgets.status, "active"),
        lte(budgetPeriods.startDate, invoiceDate),
        gt(budgetPeriods.endDate, invoiceDate)
      )
    )
    .orderBy(desc(annualBudgets.createdAt))
    .limit(1);

  return rows[0] ?? null;
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

type SaveInvoiceResult =
  | { success: true; data: { id: number }; linkedPeriodLabel?: string; linkWarning?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export async function saveInvoice(
  input: CreateInvoiceInput
): Promise<SaveInvoiceResult> {
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

  const { invoiceNumber, invoiceDate, amountCents, vendor, blobUrl, blobPathname } = parsed.data;

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
    return { success: false, error: `Failed to save invoice: ${message}` };
  }

  await recordCreation("invoice", newId, Number(admin.id));

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
};

export async function saveBulkInvoices(
  inputs: Array<CreateInvoiceInput & { filename: string }>
): Promise<ActionResult<BulkSaveOutcome[]>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const outcomes: BulkSaveOutcome[] = [];

  for (const { filename, ...invoiceInput } of inputs) {
    try {
      const result = await saveInvoice(invoiceInput);
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
      outcomes.push({ filename, error: message });
    }
  }

  revalidatePath("/invoices");
  return { success: true, data: outcomes };
}
