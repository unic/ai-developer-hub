import { NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { getR2Client, getR2Bucket, getR2AccountId } from "@/lib/r2-client";
import { requireAdmin } from "@/lib/auth-helpers";

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
  }

  const objectKey = `invoices/${randomUUID()}.pdf`;
  const bytes = await file.arrayBuffer();

  try {
    await getR2Client().send(
      new PutObjectCommand({
        Bucket: getR2Bucket(),
        Key: objectKey,
        Body: Buffer.from(bytes),
        ContentType: "application/pdf",
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Storage error";
    return NextResponse.json({ error: `Failed to upload: ${message}` }, { status: 500 });
  }

  const blobUrl = `https://${getR2AccountId()}.r2.cloudflarestorage.com/${getR2Bucket()}/${objectKey}`;
  return NextResponse.json({ objectKey, blobUrl });
}
