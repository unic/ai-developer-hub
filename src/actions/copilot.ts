"use server";

import { db } from "@/lib/db";
import {
  githubConnections,
  githubSyncEvents,
  copilotUsageMetrics,
  copilotBillingSnapshots,
  licenseAssignments,
} from "@/lib/db/schema";
import { eq, and, sql, desc, count, ne } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-helpers";
import { decryptApiKey } from "@/lib/crypto";
import { validateCopilotScopes } from "@/lib/copilot-api";
import { runCopilotSync } from "@/lib/copilot-sync";
import { recordUpdate } from "@/actions/history";
import { revalidatePath } from "next/cache";
import type { ActionResult, CopilotSyncStatus } from "@/types";

export async function enableCopilotSync(): Promise<
  ActionResult<{ connectionId: number }>
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const connection = await db.query.githubConnections.findFirst({
    where: eq(githubConnections.status, "active"),
  });

  if (!connection) {
    return { success: false, error: "No active GitHub connection" };
  }

  if (connection.copilotSyncEnabled) {
    return { success: false, error: "Copilot syncing already enabled" };
  }

  let token: string;
  try {
    token = await decryptApiKey(connection.tokenEncrypted);
  } catch {
    return {
      success: false,
      error: "Failed to decrypt stored token. Please update your token.",
    };
  }

  const scopeResult = await validateCopilotScopes(token);
  if (scopeResult.error || !scopeResult.data) {
    return {
      success: false,
      error:
        scopeResult.error || "Failed to validate Copilot scopes",
    };
  }

  if (!scopeResult.data.valid) {
    return {
      success: false,
      error: `Token missing required Copilot scopes. Current scopes: ${scopeResult.data.scopes.join(", ")}`,
    };
  }

  await db
    .update(githubConnections)
    .set({ copilotSyncEnabled: true })
    .where(eq(githubConnections.id, connection.id));

  const [syncEvent] = await db
    .insert(githubSyncEvents)
    .values({
      connectionId: connection.id,
      triggeredBy: Number(admin.id),
      status: "in_progress",
      syncType: "copilot",
    })
    .returning({ id: githubSyncEvents.id });

  try {
    await runCopilotSync(connection.id, syncEvent.id);
  } catch (err) {
    console.error("Initial Copilot sync failed:", err);
  }

  await recordUpdate("github_connection", connection.id, Number(admin.id), {
    copilotSyncEnabled: { old: false, new: true },
  });

  revalidatePath("/settings/integrations");
  revalidatePath("/copilot");

  return { success: true, data: { connectionId: connection.id } };
}

export async function disableCopilotSync(): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const connection = await db.query.githubConnections.findFirst({
    where: eq(githubConnections.status, "active"),
  });

  if (!connection) {
    return { success: false, error: "No active GitHub connection" };
  }

  await db
    .update(githubConnections)
    .set({ copilotSyncEnabled: false })
    .where(eq(githubConnections.id, connection.id));

  await recordUpdate("github_connection", connection.id, Number(admin.id), {
    copilotSyncEnabled: { old: true, new: false },
  });

  revalidatePath("/settings/integrations");

  return { success: true, data: undefined };
}

export async function triggerCopilotSync(): Promise<
  ActionResult<{ syncEventId: number }>
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const connection = await db.query.githubConnections.findFirst({
    where: and(
      eq(githubConnections.status, "active"),
      eq(githubConnections.copilotSyncEnabled, true)
    ),
  });

  if (!connection) {
    return {
      success: false,
      error: "No active GitHub connection with Copilot sync enabled",
    };
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
    SELECT ${connection.id}, ${Number(admin.id)}, 'in_progress', 'copilot'
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
    return { success: false, error: "Sync already in progress" };
  }

  const syncEventId = rows[0].id;

  try {
    await runCopilotSync(connection.id, syncEventId);
  } catch (err) {
    console.error("Copilot sync failed:", err);
  }

  revalidatePath("/copilot");
  revalidatePath("/settings/integrations");

  return { success: true, data: { syncEventId } };
}

export async function getCopilotSyncStatus(): Promise<
  ActionResult<CopilotSyncStatus>
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const connection = await db.query.githubConnections.findFirst({
    where: eq(githubConnections.status, "active"),
  });

  if (!connection || !connection.copilotSyncEnabled) {
    return {
      success: true,
      data: {
        enabled: false,
        lastSyncAt: null,
        lastSyncStatus: null,
        nextScheduledSync: null,
        dataRange: null,
        recordCounts: { metrics: 0, billing: 0, seats: 0 },
      },
    };
  }

  // Run all independent queries in parallel
  const [lastSync, [dateRange], [metricsCount], [billingCount], [seatsCount]] =
    await Promise.all([
      db.query.githubSyncEvents.findFirst({
        where: and(
          eq(githubSyncEvents.connectionId, connection.id),
          eq(githubSyncEvents.syncType, "copilot"),
          ne(githubSyncEvents.status, "in_progress")
        ),
        orderBy: [desc(githubSyncEvents.completedAt)],
      }),
      db
        .select({
          earliest: sql<string>`MIN(${copilotUsageMetrics.date})`,
          latest: sql<string>`MAX(${copilotUsageMetrics.date})`,
        })
        .from(copilotUsageMetrics)
        .where(eq(copilotUsageMetrics.connectionId, connection.id)),
      db
        .select({ value: count() })
        .from(copilotUsageMetrics)
        .where(eq(copilotUsageMetrics.connectionId, connection.id)),
      db
        .select({ value: count() })
        .from(copilotBillingSnapshots)
        .where(eq(copilotBillingSnapshots.connectionId, connection.id)),
      db
        .select({ value: count() })
        .from(licenseAssignments)
        .where(eq(licenseAssignments.source, "copilot-sync")),
    ]);

  const dataRange =
    dateRange?.earliest && dateRange?.latest
      ? { earliest: dateRange.earliest, latest: dateRange.latest }
      : null;

  const lastSyncStatus =
    lastSync?.status === "completed" ||
    lastSync?.status === "partial" ||
    lastSync?.status === "failed"
      ? lastSync.status
      : null;

  return {
    success: true,
    data: {
      enabled: true,
      lastSyncAt: lastSync?.completedAt?.toISOString() ?? null,
      lastSyncStatus,
      nextScheduledSync: null,
      dataRange,
      recordCounts: {
        metrics: metricsCount?.value ?? 0,
        billing: billingCount?.value ?? 0,
        seats: seatsCount?.value ?? 0,
      },
    },
  };
}
