import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth-helpers";
import { runAnthropicSync } from "@/lib/anthropic-sync";

export const dynamic = "force-dynamic";

async function handleSync(): Promise<NextResponse> {
  try {
    const summary = await runAnthropicSync();

    return NextResponse.json({
      success: true,
      ...summary,
    });
  } catch (err) {
    console.error("Cron Anthropic sync failed:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const authError = requireCronSecret(request);
  if (authError) return authError;
  return handleSync();
}

export async function POST(request: NextRequest) {
  const authError = requireCronSecret(request);
  if (authError) return authError;
  return handleSync();
}
