import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { db } from "@/lib/db";
import { invoices, billedCosts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { extractInvoiceFields } from "@/lib/invoice-extraction";
import { getR2Client, getR2Bucket, getR2AccountId } from "@/lib/r2-client";
import { findPeriodForDate } from "@/lib/budget-utils";
import { logIngestionAttempt } from "@/lib/ingestion-logger";
import { evaluateIngestionFilters } from "@/lib/ingestion-filters";

/** System user ID for automated/API-initiated operations */
const SYSTEM_ADMIN_USER_ID = Number.parseInt(process.env.SYSTEM_ADMIN_USER_ID ?? "1", 10);

export const dynamic = "force-dynamic";

// Max file size: 10 MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function validateAuth(request: NextRequest): boolean {
  const secret = process.env.INVOICE_INGEST_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  // Auth check
  if (!process.env.INVOICE_INGEST_SECRET) {
    return NextResponse.json(
      { success: false, error: "INVOICE_INGEST_SECRET is not configured" },
      { status: 500 }
    );
  }

  if (!validateAuth(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get("invoice");

    if (!file || !(file instanceof File)) {
      await logIngestionAttempt({
        outcome: "failed",
        errorMessage: "No PDF file provided",
        channel: "api",
      });
      return NextResponse.json(
        { success: false, error: "No PDF file provided" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      await logIngestionAttempt({
        filename: file.name,
        outcome: "failed",
        errorMessage: "File exceeds 10 MB limit",
        channel: "api",
      });
      return NextResponse.json(
        { success: false, error: "File exceeds 10 MB limit" },
        { status: 400 }
      );
    }

    if (file.type !== "application/pdf") {
      await logIngestionAttempt({
        filename: file.name,
        outcome: "failed",
        errorMessage: "File must be a PDF",
        channel: "api",
      });
      return NextResponse.json(
        { success: false, error: "File must be a PDF" },
        { status: 400 }
      );
    }

    // Read the PDF buffer
    const pdfBuffer = Buffer.from(await file.arrayBuffer());
    const objectKey = `invoices/${randomUUID()}.pdf`;

    // Extract invoice fields from raw bytes BEFORE uploading to R2
    // so failures or duplicates don't leave orphaned objects in storage
    const extraction = await extractInvoiceFields({
      objectKey,
      pdfBytes: new Uint8Array(pdfBuffer),
    });

    if (!extraction.success || !extraction.data) {
      const error = "Could not extract required fields from the provided PDF";
      await logIngestionAttempt({
        filename: file.name,
        outcome: "failed",
        errorMessage: error,
        channel: "api",
      });
      return NextResponse.json(
        { success: false, error },
        { status: 422 }
      );
    }

    const { invoiceNumber, invoiceDate, amountCents, vendor } = extraction.data;

    // Require the three critical fields
    if (!invoiceNumber || !invoiceDate || amountCents === null) {
      const error = "Could not extract required fields (invoiceNumber, invoiceDate, amountCents) from the provided PDF";
      await logIngestionAttempt({
        filename: file.name,
        vendor: vendor ?? null,
        invoiceNumber: invoiceNumber ?? null,
        invoiceDate: invoiceDate ?? null,
        amountCents: amountCents ?? null,
        outcome: "failed",
        errorMessage: error,
        channel: "api",
      });
      return NextResponse.json(
        { success: false, error },
        { status: 422 }
      );
    }

    // Check for duplicates before uploading
    const existing = await db.query.invoices.findFirst({
      where: eq(invoices.invoiceNumber, invoiceNumber),
    });

    if (existing) {
      const error = `Invoice ${invoiceNumber} already exists`;
      await logIngestionAttempt({
        filename: file.name,
        vendor: vendor ?? null,
        invoiceNumber,
        invoiceDate,
        amountCents,
        outcome: "failed",
        errorMessage: error,
        channel: "api",
      });
      return NextResponse.json(
        {
          success: false,
          error,
          data: { existingInvoiceId: existing.id },
        },
        { status: 409 }
      );
    }

    // Upload to R2 only after extraction succeeds and duplicate check passes
    await getR2Client().send(
      new PutObjectCommand({
        Bucket: getR2Bucket(),
        Key: objectKey,
        Body: pdfBuffer,
        ContentType: "application/pdf",
      })
    );

    const blobUrl = `https://${getR2AccountId()}.r2.cloudflarestorage.com/${getR2Bucket()}/${objectKey}`;

    // Evaluate ingestion filters before budget linking
    const filterResult = await evaluateIngestionFilters({
      vendor: vendor ?? null,
      invoiceNumber,
    });

    if (filterResult.filteredOut) {
      // Store the invoice but skip budget linking
      const [newInvoice] = await db
        .insert(invoices)
        .values({
          invoiceNumber,
          invoiceDate,
          amountCents,
          vendor: vendor ?? "Anthropic",
          blobUrl,
          blobPathname: objectKey,
          uploadedBy: SYSTEM_ADMIN_USER_ID,
          filteredOut: true,
        })
        .returning({ id: invoices.id });

      await logIngestionAttempt({
        filename: file.name,
        vendor: vendor ?? "Anthropic",
        invoiceNumber,
        invoiceDate,
        amountCents,
        outcome: "filtered",
        errorMessage: filterResult.reason,
        channel: "api",
        blobPathname: objectKey,
        linkedInvoiceId: newInvoice.id,
      });

      return NextResponse.json({
        success: true,
        data: {
          invoiceId: newInvoice.id,
          invoiceNumber,
          invoiceDate,
          amountCents,
          vendor: vendor ?? "Anthropic",
          action: "filtered" as const,
          filterReason: filterResult.reason,
        },
      });
    }

    // Find matching budget period
    const period = await findPeriodForDate(invoiceDate);

    // Wrap DB inserts in a transaction so a partial failure doesn't leave stray rows
    const result = await db.transaction(async (tx) => {
      let linkedBilledCostId: number | null = null;
      let action: "created" | "created_unlinked" = "created_unlinked";

      if (period) {
        // Create billed cost entry and link
        const description = vendor
          ? `Invoice ${invoiceNumber} — ${vendor}`
          : `Invoice ${invoiceNumber}`;

        const [cost] = await tx
          .insert(billedCosts)
          .values({
            periodId: period.id,
            amountCents,
            invoiceDate,
            description,
            vendorReference: invoiceNumber,
          })
          .returning({ id: billedCosts.id });

        linkedBilledCostId = cost.id;
        action = "created";
      }

      // Create the invoice record
      const [newInvoice] = await tx
        .insert(invoices)
        .values({
          invoiceNumber,
          invoiceDate,
          amountCents,
          vendor: vendor ?? "Anthropic",
          blobUrl,
          blobPathname: objectKey,
          uploadedBy: SYSTEM_ADMIN_USER_ID,
          linkedBilledCostId,
        })
        .returning({ id: invoices.id });

      return { invoiceId: newInvoice.id, action, linkedBilledCostId };
    });

    await logIngestionAttempt({
      filename: file.name,
      vendor: vendor ?? "Anthropic",
      invoiceNumber,
      invoiceDate,
      amountCents,
      outcome: "success",
      channel: "api",
      blobPathname: objectKey,
      linkedInvoiceId: result.invoiceId,
    });

    return NextResponse.json({
      success: true,
      data: {
        invoiceId: result.invoiceId,
        invoiceNumber,
        invoiceDate,
        amountCents,
        vendor: vendor ?? "Anthropic",
        action: result.action,
        linkedPeriodId: period?.id ?? null,
        linkedPeriodLabel: period?.periodLabel ?? null,
      },
    });
  } catch (err) {
    console.error("Invoice ingestion error:", err);
    const message = err instanceof Error ? err.message : "An unexpected error occurred";
    try {
      await logIngestionAttempt({
        outcome: "failed",
        errorMessage: message,
        channel: "api",
      });
    } catch {
      // Best-effort logging — don't mask the original error
    }
    return NextResponse.json(
      { success: false, error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    );
  }
}
