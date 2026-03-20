import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth-helpers";
import { run } from "@/lib/sync/sources/github-copilot";

export const dynamic = "force-dynamic";

async function handleSync(): Promise<NextResponse> {
  try {
    const result = await run(undefined);
    return NextResponse.json({ ok: true, eventId: result.eventId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "Sync already in progress") {
      return NextResponse.json({ ok: false, reason: "sync_in_progress" });
    }
    console.error("Cron GitHub Copilot sync failed:", message);
    return NextResponse.json({ ok: false, reason: message });
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
