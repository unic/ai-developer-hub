import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { db } from "@/lib/db";
import { invoices, billedCosts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { extractInvoiceFields } from "@/lib/invoice-extraction";
import { getR2Client, getR2Bucket, getR2AccountId } from "@/lib/r2-client";
import { findPeriodForDate } from "@/actions/invoice-sync";

/** System user ID for automated/API-initiated operations */
const SYSTEM_ADMIN_USER_ID = 1;

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
      return NextResponse.json(
        { success: false, error: "No PDF file provided" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: "File exceeds 10 MB limit" },
        { status: 400 }
      );
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { success: false, error: "File must be a PDF" },
        { status: 400 }
      );
    }

    // Read the PDF buffer
    const pdfBuffer = Buffer.from(await file.arrayBuffer());

    // Upload to R2 first (matching existing upload-url and bulk-upload patterns)
    const objectKey = `invoices/${randomUUID()}.pdf`;

    await getR2Client().send(
      new PutObjectCommand({
        Bucket: getR2Bucket(),
        Key: objectKey,
        Body: pdfBuffer,
        ContentType: "application/pdf",
      })
    );

    const blobUrl = `https://${getR2AccountId()}.r2.cloudflarestorage.com/${getR2Bucket()}/${objectKey}`;

    // Extract invoice fields using existing pipeline
    const extraction = await extractInvoiceFields({
      objectKey,
      pdfBytes: new Uint8Array(pdfBuffer),
    });

    if (!extraction.success || !extraction.data) {
      return NextResponse.json(
        {
          success: false,
          error: "Could not extract required fields from the provided PDF",
        },
        { status: 422 }
      );
    }

    const { invoiceNumber, invoiceDate, amountCents, vendor } = extraction.data;

    // Require the three critical fields
    if (!invoiceNumber || !invoiceDate || amountCents === null) {
      return NextResponse.json(
        {
          success: false,
          error: "Could not extract required fields (invoiceNumber, invoiceDate, amountCents) from the provided PDF",
        },
        { status: 422 }
      );
    }

    // Check for duplicates
    const existing = await db.query.invoices.findFirst({
      where: eq(invoices.invoiceNumber, invoiceNumber),
    });

    if (existing) {
      return NextResponse.json(
        {
          success: false,
          error: `Invoice ${invoiceNumber} already exists`,
          data: { existingInvoiceId: existing.id },
        },
        { status: 409 }
      );
    }

    // Find matching budget period
    const period = await findPeriodForDate(invoiceDate);

    // Create invoice record
    let linkedBilledCostId: number | null = null;
    let action: "created" | "created_unlinked" = "created_unlinked";

    if (period) {
      // Create billed cost entry and link
      const description = vendor
        ? `Invoice ${invoiceNumber} — ${vendor}`
        : `Invoice ${invoiceNumber}`;

      const [cost] = await db
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

    // Create the invoice record (use system admin user ID 1 for API uploads)
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
        linkedBilledCostId,
      })
      .returning({ id: invoices.id });

    return NextResponse.json({
      success: true,
      data: {
        invoiceId: newInvoice.id,
        invoiceNumber,
        invoiceDate,
        amountCents,
        vendor: vendor ?? "Anthropic",
        action,
        linkedPeriodId: period?.id ?? null,
        linkedPeriodLabel: period?.periodLabel ?? null,
      },
    });
  } catch (err) {
    console.error("Invoice ingestion error:", err);
    return NextResponse.json(
      { success: false, error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    );
  }
}
