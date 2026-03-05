import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import * as unzipper from "unzipper";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2Client, R2_BUCKET, R2_ACCOUNT_ID } from "@/lib/r2-client";
import { requireAdmin } from "@/lib/auth-helpers";
import { extractInvoiceFields } from "@/lib/invoice-extraction";

export const maxDuration = 60;

const MAX_ZIP_SIZE = 50 * 1024 * 1024;
const MAX_PDFS = 50;

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (
      contentType !== "application/zip" &&
      contentType !== "application/x-zip-compressed"
    ) {
      return NextResponse.json(
        { error: "Content-Type must be application/zip or application/x-zip-compressed" },
        { status: 400 },
      );
    }

    const bytes = await request.arrayBuffer();

    if (bytes.byteLength > MAX_ZIP_SIZE) {
      return NextResponse.json(
        { error: "Zip file exceeds 50 MB limit" },
        { status: 400 },
      );
    }

    const directory = await unzipper.Open.buffer(Buffer.from(bytes));

    const pdfEntries: unzipper.File[] = [];
    const skipped: string[] = [];

    for (const entry of directory.files) {
      if (entry.path.toLowerCase().endsWith(".pdf")) {
        pdfEntries.push(entry);
      } else {
        skipped.push(entry.path);
      }
    }

    if (pdfEntries.length === 0) {
      return NextResponse.json(
        { error: "No PDF files found in zip" },
        { status: 400 },
      );
    }

    // Limit to max 50 PDFs; push extras to skipped
    if (pdfEntries.length > MAX_PDFS) {
      const extras = pdfEntries.splice(MAX_PDFS);
      for (const extra of extras) {
        skipped.push(extra.path);
      }
    }

    const results: {
      filename: string;
      objectKey: string;
      blobUrl: string;
      extracted: Record<string, unknown> | null;
      error: string | null;
    }[] = [];

    for (const entry of pdfEntries) {
      const buffer = await entry.buffer();
      const objectKey = `invoices/${randomUUID()}.pdf`;

      await r2Client.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: objectKey,
          Body: buffer,
          ContentType: "application/pdf",
        }),
      );

      const blobUrl = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${objectKey}`;

      const result = await extractInvoiceFields({ objectKey });

      results.push({
        filename: entry.path,
        objectKey,
        blobUrl,
        extracted: result.success ? result.data : null,
        error: result.success ? null : result.error,
      });
    }

    return NextResponse.json({ results, skipped });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to process zip: ${message}` },
      { status: 500 },
    );
  }
}
