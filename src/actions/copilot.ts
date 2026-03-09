"use server";

import { db } from "@/lib/db";
import {
  githubConnections,
  githubSyncEvents,
  copilotUsageMetrics,
  copilotBillingSnapshots,
  licenseAssignments,
} from "@/lib/db/schema";
import { eq, and, sql, desc, count } from "drizzle-orm";
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

  runCopilotSync(connection.id, syncEvent.id).catch(console.error);

  await recordUpdate("github_connection", connection.id, Number(admin.id), {
    copilotSyncEnabled: { old: false, new: true },
  });

  revalidatePath("/settings/integrations");

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

  const inProgress = await db.query.githubSyncEvents.findFirst({
    where: and(
      eq(githubSyncEvents.connectionId, connection.id),
      eq(githubSyncEvents.syncType, "copilot"),
      eq(githubSyncEvents.status, "in_progress")
    ),
  });

  if (inProgress) {
    return { success: false, error: "Sync already in progress" };
  }

  const [syncEvent] = await db
    .insert(githubSyncEvents)
    .values({
      connectionId: connection.id,
      triggeredBy: Number(admin.id),
      status: "in_progress",
      syncType: "copilot",
    })
    .returning({ id: githubSyncEvents.id });

  runCopilotSync(connection.id, syncEvent.id).catch(console.error);

  revalidatePath("/copilot");

  return { success: true, data: { syncEventId: syncEvent.id } };
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
          eq(githubSyncEvents.syncType, "copilot")
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
