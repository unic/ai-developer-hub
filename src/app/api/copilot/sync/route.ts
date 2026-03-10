import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { githubConnections, githubSyncEvents } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
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

  // Clean up stale in_progress events older than 10 minutes (abandoned serverless runs)
  const staleThreshold = new Date(Date.now() - 10 * 60 * 1000);
  await db
    .update(githubSyncEvents)
    .set({
      status: "failed",
      completedAt: new Date(),
      errorMessage: "Sync timed out (stale in_progress event cleaned up)",
    })
    .where(
      and(
        eq(githubSyncEvents.connectionId, connection.id),
        eq(githubSyncEvents.syncType, "copilot"),
        eq(githubSyncEvents.status, "in_progress"),
        sql`${githubSyncEvents.startedAt} < ${staleThreshold}`
      )
    );

  // Atomic insert: only succeeds if no in_progress event exists for this connection
  const insertResult = await db.execute<{ id: number }>(sql`
    INSERT INTO github_sync_events (connection_id, triggered_by, status, sync_type)
    SELECT ${connection.id}, ${connection.connectedBy}, 'in_progress', 'copilot'
    WHERE NOT EXISTS (
      SELECT 1 FROM github_sync_events
      WHERE connection_id = ${connection.id}
        AND sync_type = 'copilot'
        AND status = 'in_progress'
    )
    RETURNING id
  `);

  const rows = insertResult.rows;
  if (!rows || rows.length === 0) {
    return NextResponse.json(
      { success: false, error: "Sync already in progress" },
      { status: 409 }
    );
  }

  const syncEventId = rows[0].id;

  // Run sync to completion before responding
  try {
    await runCopilotSync(connection.id, syncEventId);
  } catch (err) {
    console.error("Cron Copilot sync failed:", err);
  }

  // Query the completed sync event to include billing metrics
  const syncEvent = await db.query.githubSyncEvents.findFirst({
    where: eq(githubSyncEvents.id, syncEventId),
  });

  return NextResponse.json({
    success: true,
    syncEventId,
    billingLinked: syncEvent?.billingLinked ?? null,
    billingSkipped: syncEvent?.billingSkipped ?? null,
  });
}
