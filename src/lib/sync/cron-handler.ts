import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth-helpers";

type SyncRunner = (triggeredBy?: number) => Promise<{ eventId: number }>;

/**
 * Creates GET and POST route handlers for a cron-triggered sync source.
 * Handles auth, error handling, and "sync already in progress" detection.
 */
export function makeCronSyncRoute(runner: SyncRunner, label: string) {
  async function handleSync(): Promise<NextResponse> {
    try {
      const result = await runner(undefined);
      return NextResponse.json({ ok: true, eventId: result.eventId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "Sync already in progress") {
        // 409, not 200: contention is a real outcome the caller should see.
        // Still not an alertable failure — Vercel cron treats 4xx as handled.
        return NextResponse.json(
          { ok: false, reason: "sync_in_progress" },
          { status: 409 }
        );
      }
      console.error(`Cron ${label} sync failed:`, message);
      // 500, not 200. Every unexpected failure previously returned 200, which
      // is why 63 cron failures over seven weeks never surfaced as anything
      // but a healthy-looking green tick in cron monitoring.
      return NextResponse.json({ ok: false, reason: message }, { status: 500 });
    }
  }

  async function GET(request: NextRequest) {
    const authError = requireCronSecret(request);
    if (authError) return authError;
    return handleSync();
  }

  async function POST(request: NextRequest) {
    const authError = requireCronSecret(request);
    if (authError) return authError;
    return handleSync();
  }

  return { GET, POST };
}
