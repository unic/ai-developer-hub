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
import { getSystemAdminUserId, requireBearerSecret } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

// Max file size: 10 MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const authError = requireBearerSecret(request, "INVOICE_INGEST_SECRET");
  if (authError) return authError;

  // Validate SYSTEM_ADMIN_USER_ID before any processing — fails fast with a
  // clear error rather than propagating NaN or the wrong user id into DB rows.
  let systemAdminUserId: number;
  try {
    systemAdminUserId = await getSystemAdminUserId();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server misconfigured";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }

  // Read incoming Content-Type up front so we can both branch on it and
  // include it in any failure-log message (helps diagnose bad callers like
  // Power Automate flows that omit the multipart boundary).
  const contentType = request.headers.get("content-type") ?? "";
  const headerVendor = request.headers.get("x-vendor");

  let pdfBuffer: Buffer;
  let filename: string;

  try {
    if (contentType.toLowerCase().startsWith("application/pdf")) {
      // Raw PDF body path — used by callers (e.g. Power Automate) that can't
      // easily build a multipart envelope. Filename comes from X-Filename;
      // optional X-Vendor lets the caller skip the default "Anthropic".
      const arrayBuffer = await request.arrayBuffer();
      pdfBuffer = Buffer.from(arrayBuffer);
      filename = request.headers.get("x-filename")?.trim() || "invoice.pdf";

      if (pdfBuffer.byteLength > MAX_FILE_SIZE) {
        await logIngestionAttempt({
          filename,
          outcome: "failed",
          errorMessage: "File exceeds 10 MB limit",
          channel: "api",
        });
        return NextResponse.json(
          { success: false, error: "File exceeds 10 MB limit" },
          { status: 400 },
        );
      }

      // Cheap sanity check: a real PDF starts with "%PDF-". This catches the
      // common Power Automate mistake of POSTing a base64 string with
      // Content-Type: application/pdf instead of decoded binary.
      if (
        pdfBuffer.byteLength < 5 ||
        pdfBuffer.subarray(0, 5).toString("ascii") !== "%PDF-"
      ) {
        const error =
          "Body is not a valid PDF (missing %PDF- header). If sending from Power Automate, wrap the body in base64ToBinary(...).";
        await logIngestionAttempt({
          filename,
          outcome: "failed",
          errorMessage: error,
          channel: "api",
        });
        return NextResponse.json({ success: false, error }, { status: 400 });
      }
    } else if (contentType.toLowerCase().startsWith("multipart/form-data")) {
      // Existing multipart path — preserved for browser uploads and any
      // callers already sending properly-formed multipart bodies.
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
          { status: 400 },
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
          { status: 400 },
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
          { status: 400 },
        );
      }

      pdfBuffer = Buffer.from(await file.arrayBuffer());
      filename = file.name;
    } else {
      const error = `Unsupported Content-Type "${contentType || "(none)"}". Use application/pdf (raw body) or multipart/form-data with field "invoice".`;
      await logIngestionAttempt({
        outcome: "failed",
        errorMessage: error,
        channel: "api",
      });
      return NextResponse.json({ success: false, error }, { status: 415 });
    }

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
        filename,
        outcome: "failed",
        errorMessage: error,
        channel: "api",
      });
      return NextResponse.json({ success: false, error }, { status: 422 });
    }

    const { invoiceNumber, invoiceDate, amountCents, vendor } = extraction.data;

    // Require the three critical fields
    if (!invoiceNumber || !invoiceDate || amountCents === null) {
      const error =
        "Could not extract required fields (invoiceNumber, invoiceDate, amountCents) from the provided PDF";
      await logIngestionAttempt({
        filename,
        vendor: vendor ?? null,
        invoiceNumber: invoiceNumber ?? null,
        invoiceDate: invoiceDate ?? null,
        amountCents: amountCents ?? null,
        outcome: "failed",
        errorMessage: error,
        channel: "api",
      });
      return NextResponse.json({ success: false, error }, { status: 422 });
    }

    // Check for duplicates before uploading
    const existing = await db.query.invoices.findFirst({
      where: eq(invoices.invoiceNumber, invoiceNumber),
    });

    if (existing) {
      const error = `Invoice ${invoiceNumber} already exists`;
      await logIngestionAttempt({
        filename,
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
        { status: 409 },
      );
    }

    // Upload to R2 only after extraction succeeds and duplicate check passes
    await getR2Client().send(
      new PutObjectCommand({
        Bucket: getR2Bucket(),
        Key: objectKey,
        Body: pdfBuffer,
        ContentType: "application/pdf",
      }),
    );

    const blobUrl = `https://${getR2AccountId()}.r2.cloudflarestorage.com/${getR2Bucket()}/${objectKey}`;

    // Normalize vendor once so filter evaluation and persistence are consistent
    const resolvedVendor = vendor ?? headerVendor ?? "Anthropic";

    // Evaluate ingestion filters before budget linking
    const filterResult = await evaluateIngestionFilters({
      vendor: resolvedVendor,
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
          vendor: resolvedVendor,
          blobUrl,
          blobPathname: objectKey,
          uploadedBy: systemAdminUserId,
          filteredOut: true,
        })
        .returning({ id: invoices.id });

      await logIngestionAttempt({
        filename,
        vendor: resolvedVendor,
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
          vendor: resolvedVendor,
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
          vendor: resolvedVendor,
          blobUrl,
          blobPathname: objectKey,
          uploadedBy: systemAdminUserId,
          linkedBilledCostId,
        })
        .returning({ id: invoices.id });

      return { invoiceId: newInvoice.id, action, linkedBilledCostId };
    });

    await logIngestionAttempt({
      filename,
      vendor: resolvedVendor,
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
        vendor: resolvedVendor,
        action: result.action,
        linkedPeriodId: period?.id ?? null,
        linkedPeriodLabel: period?.periodLabel ?? null,
      },
    });
  } catch (err) {
    console.error("Invoice ingestion error:", err);
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred";
    try {
      await logIngestionAttempt({
        outcome: "failed",
        errorMessage: `${message} (Content-Type: ${contentType || "(none)"})`,
        channel: "api",
      });
    } catch {
      // Best-effort logging — don't mask the original error
    }
    return NextResponse.json(
      {
        success: false,
        error: "An unexpected error occurred. Please try again.",
      },
      { status: 500 },
    );
  }
}
