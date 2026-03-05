import { NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { requireAdmin } from "@/lib/auth-helpers";

const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ?? "",
  },
});

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
  const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME ?? "";
  const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID ?? "";

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
    ContentType: "application/pdf",
  });

  const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 300 });
  const blobUrl = `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${objectKey}`;

  return NextResponse.json({ uploadUrl, objectKey, blobUrl });
}
