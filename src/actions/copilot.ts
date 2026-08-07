"use server";

import { db } from "@/lib/db";
import {
  githubConnections,
  copilotUsageMetrics,
  copilotBillingSnapshots,
  licenseAssignments,
} from "@/lib/db/schema";
import { eq, sql, count } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-helpers";
import { decryptApiKey } from "@/lib/crypto";
import { validateCopilotScopes } from "@/lib/copilot-api";
import { run as runCopilotSource } from "@/lib/sync/sources/github-copilot";
import {
  getLastCompletedSyncEvent,
  mapOutcomeToLegacyStatus,
} from "@/lib/sync/queries";
import { recordUpdate } from "@/lib/history";
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
      error: scopeResult.error || "Failed to validate Copilot scopes",
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

  try {
    await runCopilotSource(Number(admin.id));
  } catch (err) {
    console.error("Initial Copilot sync failed:", err);
  }

  await recordUpdate(
    "github_connection",
    connection.id,
    Number(admin.id),
    {
      copilotSyncEnabled: { old: false, new: true },
    },
    { source: "ui" },
  );

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

  await recordUpdate(
    "github_connection",
    connection.id,
    Number(admin.id),
    {
      copilotSyncEnabled: { old: true, new: false },
    },
    { source: "ui" },
  );

  revalidatePath("/settings/integrations");

  return { success: true, data: undefined };
}

export async function triggerCopilotSync(): Promise<
  ActionResult<{ syncEventId: number }>
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  try {
    const result = await runCopilotSource(Number(admin.id));

    revalidatePath("/copilot");
    revalidatePath("/settings/integrations");

    return { success: true, data: { syncEventId: result.eventId } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
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
      getLastCompletedSyncEvent("github_copilot_billing"),
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

  const lastSyncStatus = mapOutcomeToLegacyStatus(lastSync?.outcome);

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
