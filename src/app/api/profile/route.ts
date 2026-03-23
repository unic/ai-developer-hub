import { NextRequest, NextResponse } from "next/server";
import { requireBearerSecret } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = requireBearerSecret(request, "PROFILE_API_SECRET");
  if (authError) return authError;

  return NextResponse.json({ success: true, data: null });
}
