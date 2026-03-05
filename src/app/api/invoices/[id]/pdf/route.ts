import { NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Client, R2_BUCKET } from "@/lib/r2-client";
import { requireAdmin } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { invoices } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const admin = await requireAdmin();
  if (!admin) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id: idStr } = params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return new NextResponse("Not found", { status: 404 });
  }

  const invoice = await db.query.invoices.findFirst({
    where: eq(invoices.id, id),
  });
  if (!invoice) {
    return new NextResponse("Not found", { status: 404 });
  }

  let presignedUrl: string;
  try {
    const command = new GetObjectCommand({ Bucket: R2_BUCKET, Key: invoice.blobPathname });
    presignedUrl = await getSignedUrl(r2Client, command, { expiresIn: 300 });
  } catch {
    return new NextResponse("Storage error", { status: 500 });
  }

  return NextResponse.redirect(presignedUrl, 302);
}
