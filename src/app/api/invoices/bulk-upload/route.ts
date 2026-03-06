import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import * as unzipper from "unzipper";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getR2Client, getR2Bucket, getR2AccountId } from "@/lib/r2-client";
import { requireAdmin } from "@/lib/auth-helpers";
import { extractInvoiceFields } from "@/lib/invoice-extraction";

export const maxDuration = 60;

const MAX_ZIP_SIZE = 50 * 1024 * 1024;
const MAX_PDFS = 50;

export async function POST(request: Request) {
  const uploadedKeys: string[] = [];

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
      let objectKey = "";
      let blobUrl = "";
      try {
        const buffer = await entry.buffer();
        objectKey = `invoices/${randomUUID()}.pdf`;

        await getR2Client().send(
          new PutObjectCommand({
            Bucket: getR2Bucket(),
            Key: objectKey,
            Body: buffer,
            ContentType: "application/pdf",
          }),
        );
        uploadedKeys.push(objectKey);

        blobUrl = `https://${getR2AccountId()}.r2.cloudflarestorage.com/${getR2Bucket()}/${objectKey}`;

        const result = await extractInvoiceFields({
          objectKey,
          pdfBytes: new Uint8Array(buffer),
        });

        results.push({
          filename: entry.path,
          objectKey,
          blobUrl,
          extracted: result.success ? result.data : null,
          error: result.success ? null : result.error,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          filename: entry.path,
          objectKey,
          blobUrl,
          extracted: null,
          error: message,
        });
      }
    }

    return NextResponse.json({ results, skipped });
  } catch (err: unknown) {
    // Best-effort cleanup of already-uploaded objects
    for (const key of uploadedKeys) {
      try {
        await getR2Client().send(
          new DeleteObjectCommand({ Bucket: getR2Bucket(), Key: key }),
        );
      } catch {
        // Ignore cleanup failures
      }
    }

    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to process zip: ${message}` },
      { status: 500 },
    );
  }
}
