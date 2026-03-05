import { NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { r2Client, R2_BUCKET, R2_ACCOUNT_ID } from "@/lib/r2-client";
import { requireAdmin } from "@/lib/auth-helpers";

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { contentType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (body.contentType !== "application/pdf") {
    return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
  }

  const objectKey = `invoices/${randomUUID()}.pdf`;

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: objectKey,
    ContentType: "application/pdf",
  });

  const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 300 });
  const blobUrl = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${objectKey}`;

  return NextResponse.json({ uploadUrl, objectKey, blobUrl });
}
