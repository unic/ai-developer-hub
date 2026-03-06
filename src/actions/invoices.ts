"use server";

import { db } from "@/lib/db";
import {
  invoices,
  billedCosts,
  budgetPeriods,
  annualBudgets,
} from "@/lib/db/schema";
import { eq, and, lte, gt, desc } from "drizzle-orm";
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
  | { success: true; data: { id: number }; warning?: string; linkedPeriodLabel?: string; linkWarning?: string }
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
    ...(isDuplicate ? { warning: "An invoice with this number already exists." } : {}),
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
