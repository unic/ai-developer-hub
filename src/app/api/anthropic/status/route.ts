import { NextResponse } from "next/server";
import { checkAnthropicStatus } from "@/actions/anthropic-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await checkAnthropicStatus();

  if (!result.success) {
    return NextResponse.json(result, { status: 401 });
  }

  return NextResponse.json(result);
}
