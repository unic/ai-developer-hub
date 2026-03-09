import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { githubConnections, githubSyncEvents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { runCopilotSync } from "@/lib/copilot-sync";

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

  // Find active connection with Copilot sync enabled
  const connection = await db.query.githubConnections.findFirst({
    where: and(
      eq(githubConnections.status, "active"),
      eq(githubConnections.copilotSyncEnabled, true)
    ),
  });

  if (!connection) {
    return NextResponse.json(
      { success: false, error: "No active connection with Copilot sync enabled" },
      { status: 404 }
    );
  }

  // Check mutual exclusion
  const inProgress = await db.query.githubSyncEvents.findFirst({
    where: and(
      eq(githubSyncEvents.connectionId, connection.id),
      eq(githubSyncEvents.syncType, "copilot"),
      eq(githubSyncEvents.status, "in_progress")
    ),
  });

  if (inProgress) {
    // Clean up stale events older than 10 minutes
    const staleThreshold = new Date(Date.now() - 10 * 60 * 1000);
    if (inProgress.startedAt < staleThreshold) {
      await db
        .update(githubSyncEvents)
        .set({
          status: "failed",
          completedAt: new Date(),
          errorMessage: "Sync timed out (stale in_progress event cleaned up)",
        })
        .where(eq(githubSyncEvents.id, inProgress.id));
    } else {
      return NextResponse.json(
        { success: false, error: "Sync already in progress" },
        { status: 409 }
      );
    }
  }

  // Create sync event (use connectedBy as the triggered_by user for cron)
  const [syncEvent] = await db
    .insert(githubSyncEvents)
    .values({
      connectionId: connection.id,
      triggeredBy: connection.connectedBy,
      status: "in_progress",
      syncType: "copilot",
    })
    .returning({ id: githubSyncEvents.id });

  // Run sync to completion before responding
  try {
    await runCopilotSync(connection.id, syncEvent.id);
  } catch (err) {
    console.error("Cron Copilot sync failed:", err);
  }

  return NextResponse.json({
    success: true,
    syncEventId: syncEvent.id,
  });
}
