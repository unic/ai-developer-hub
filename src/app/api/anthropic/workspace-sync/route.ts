import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth-helpers";
import { syncAnthropicWorkspaces } from "@/lib/anthropic-workspace-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = requireCronSecret(request);
  if (authError) return authError;

  try {
    const result = await syncAnthropicWorkspaces();
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("Workspace sync failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
