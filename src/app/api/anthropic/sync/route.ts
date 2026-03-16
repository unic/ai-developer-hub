import { NextRequest, NextResponse } from "next/server";
import { runAnthropicSync } from "@/lib/anthropic-sync";

export async function POST(request: NextRequest) {
  // Authenticate with CRON_SECRET
  const authHeader = request.headers.get("authorization");
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

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
