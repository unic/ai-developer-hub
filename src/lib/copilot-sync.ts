import { db } from "@/lib/db";
import {
  aiTools,
  accessTiers,
  licenseAssignments,
  githubConnections,
  githubProfiles,
  githubSyncEvents,
  copilotUsageMetrics,
  copilotBillingSnapshots,
  billedCosts,
  budgetPeriods,
} from "@/lib/db/schema";
import {
  fetchCopilotBilling,
  fetchCopilotSeats,
  fetchCopilotMetrics,
} from "@/lib/copilot-api";
import { decryptApiKey } from "@/lib/crypto";
import { eq, and, sql, desc, isNull, between } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SyncConnection {
  id: number;
  orgLogin: string;
  tokenEncrypted: string;
  copilotSyncEnabled: boolean;
}

interface BillingSyncResult {
  seatsProcessed: number;
  billingProcessed: number;
}

interface SeatSyncResult {
  seatsProcessed: number;
}

interface MetricsSyncResult {
  metricsProcessed: number;
}

// ---------------------------------------------------------------------------
// Function 1: syncBillingData
// ---------------------------------------------------------------------------

export async function syncBillingData(
  connection: SyncConnection,
  token: string
): Promise<BillingSyncResult> {
  const billingResponse = await fetchCopilotBilling(
    token,
    connection.orgLogin
  );

  if (billingResponse.error || !billingResponse.data) {
    throw new Error(
      billingResponse.error ?? "Failed to fetch Copilot billing data"
    );
  }

  const billing = billingResponse.data;

  // Upsert "GitHub Copilot" AI Tool
  let tool = await db.query.aiTools.findFirst({
    where: eq(aiTools.name, "GitHub Copilot"),
  });

  if (!tool) {
    const [inserted] = await db
      .insert(aiTools)
      .values({ name: "GitHub Copilot", vendor: "GitHub" })
      .returning();
    tool = inserted;
  }

  // Update maxLicenses
  await db
    .update(aiTools)
    .set({
      maxLicenses: billing.seat_breakdown.total,
      updatedAt: new Date(),
    })
    .where(eq(aiTools.id, tool.id));

  // Upsert access tiers
  const planPrices: Record<string, number> = {
    business: 1900,
    enterprise: 3900,
  };

  for (const [planName, costCents] of Object.entries(planPrices)) {
    const tierName = planName.charAt(0).toUpperCase() + planName.slice(1);
    const tier = await db.query.accessTiers.findFirst({
      where: and(
        eq(accessTiers.toolId, tool.id),
        eq(accessTiers.name, tierName)
      ),
    });

    if (!tier) {
      await db.insert(accessTiers).values({
        toolId: tool.id,
        name: tierName,
        monthlyCostCents: costCents,
      });
    }
  }

  // Upsert billing snapshot for current month
  const now = new Date();
  const billingMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const seatCostCents = planPrices[billing.plan_type] ?? 1900;
  const totalCostCents = billing.seat_breakdown.total * seatCostCents;

  await db
    .insert(copilotBillingSnapshots)
    .values({
      connectionId: connection.id,
      billingMonth,
      planType: billing.plan_type,
      totalSeats: billing.seat_breakdown.total,
      activeSeats: billing.seat_breakdown.active_this_cycle,
      seatCostCents,
      totalCostCents,
    })
    .onConflictDoUpdate({
      target: [
        copilotBillingSnapshots.connectionId,
        copilotBillingSnapshots.billingMonth,
      ],
      set: {
        planType: billing.plan_type,
        totalSeats: billing.seat_breakdown.total,
        activeSeats: billing.seat_breakdown.active_this_cycle,
        seatCostCents,
        totalCostCents,
        updatedAt: new Date(),
      },
    });

  // Try to link to billedCosts if a matching budget period exists
  const matchingPeriod = await db.query.budgetPeriods.findFirst({
    where: and(
      sql`${budgetPeriods.startDate} <= ${billingMonth}`,
      sql`${budgetPeriods.endDate} >= ${billingMonth}`
    ),
  });

  if (matchingPeriod) {
    const vendorReference = `copilot-billing-${billingMonth}`;
    const existingCost = await db.query.billedCosts.findFirst({
      where: eq(billedCosts.vendorReference, vendorReference),
    });

    if (!existingCost) {
      const monthDate = new Date(billingMonth);
      const monthName = monthDate.toLocaleString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });

      const [insertedCost] = await db
        .insert(billedCosts)
        .values({
          periodId: matchingPeriod.id,
          amountCents: totalCostCents,
          invoiceDate: billingMonth,
          description: `GitHub Copilot - ${monthName}`,
          vendorReference,
        })
        .returning();

      await db
        .update(copilotBillingSnapshots)
        .set({ linkedBilledCostId: insertedCost.id })
        .where(
          and(
            eq(copilotBillingSnapshots.connectionId, connection.id),
            eq(copilotBillingSnapshots.billingMonth, billingMonth)
          )
        );
    }
  }

  return {
    seatsProcessed: billing.seat_breakdown.total,
    billingProcessed: 1,
  };
}

// ---------------------------------------------------------------------------
// Function 2: syncSeatAssignments
// ---------------------------------------------------------------------------

export async function syncSeatAssignments(
  connection: SyncConnection,
  token: string
): Promise<SeatSyncResult> {
  const seatsResponse = await fetchCopilotSeats(token, connection.orgLogin);

  if (seatsResponse.error || !seatsResponse.data) {
    throw new Error(
      seatsResponse.error ?? "Failed to fetch Copilot seat assignments"
    );
  }

  const seats = seatsResponse.data;

  // Get the GitHub Copilot tool
  const tool = await db.query.aiTools.findFirst({
    where: eq(aiTools.name, "GitHub Copilot"),
  });

  if (!tool) {
    throw new Error(
      "GitHub Copilot tool not found. Run syncBillingData first."
    );
  }

  // Build githubId → userId map from all github profiles
  const profiles = await db.query.githubProfiles.findMany();
  const githubIdToUserId = new Map<number, number>();
  for (const profile of profiles) {
    githubIdToUserId.set(profile.githubId, profile.userId);
  }

  // Get all access tiers for this tool
  const tiers = await db.query.accessTiers.findMany({
    where: eq(accessTiers.toolId, tool.id),
  });
  const tierByName = new Map<string, typeof tiers[number]>();
  for (const tier of tiers) {
    tierByName.set(tier.name, tier);
  }

  // Track which userIds have active seats
  const activeUserIds = new Set<number>();

  for (const seat of seats) {
    const userId = githubIdToUserId.get(seat.assignee.id);
    if (!userId) continue;

    activeUserIds.add(userId);

    // Get the correct tier for this seat's plan_type
    const tierName =
      seat.plan_type.charAt(0).toUpperCase() + seat.plan_type.slice(1);
    const tier = tierByName.get(tierName);
    if (!tier) continue;

    const isActive = !seat.pending_cancellation_date;

    // Find existing assignment by userId + toolId + source="copilot-sync"
    const existing = await db.query.licenseAssignments.findFirst({
      where: and(
        eq(licenseAssignments.userId, userId),
        eq(licenseAssignments.toolId, tool.id),
        eq(licenseAssignments.source, "copilot-sync")
      ),
    });

    if (existing) {
      if (existing.status === "active" && isActive) {
        // Update tier if changed
        if (existing.tierId !== tier.id) {
          await db
            .update(licenseAssignments)
            .set({
              tierId: tier.id,
              costAtAssignmentCents: tier.monthlyCostCents,
              updatedAt: new Date(),
            })
            .where(eq(licenseAssignments.id, existing.id));
        }
      } else if (existing.status === "inactive" && isActive) {
        // Reactivate
        await db
          .update(licenseAssignments)
          .set({
            status: "active",
            tierId: tier.id,
            costAtAssignmentCents: tier.monthlyCostCents,
            revokedAt: null,
            assignedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(licenseAssignments.id, existing.id));
      }
    } else if (isActive) {
      // Insert new assignment
      await db.insert(licenseAssignments).values({
        userId,
        toolId: tool.id,
        tierId: tier.id,
        costAtAssignmentCents: tier.monthlyCostCents,
        status: "active",
        source: "copilot-sync",
      });
    }
  }

  // Revoke removed seats: find active copilot-sync assignments not in current seat list
  const activeAssignments = await db.query.licenseAssignments.findMany({
    where: and(
      eq(licenseAssignments.toolId, tool.id),
      eq(licenseAssignments.source, "copilot-sync"),
      eq(licenseAssignments.status, "active")
    ),
  });

  for (const assignment of activeAssignments) {
    if (!activeUserIds.has(assignment.userId)) {
      await db
        .update(licenseAssignments)
        .set({
          status: "inactive",
          revokedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(licenseAssignments.id, assignment.id));
    }
  }

  return { seatsProcessed: seats.length };
}

// ---------------------------------------------------------------------------
// Function 3: syncUsageMetrics
// ---------------------------------------------------------------------------

export async function syncUsageMetrics(
  connection: SyncConnection,
  token: string
): Promise<MetricsSyncResult> {
  // Find latest metric date for this connection
  const latestRow = await db.query.copilotUsageMetrics.findFirst({
    where: eq(copilotUsageMetrics.connectionId, connection.id),
    orderBy: desc(copilotUsageMetrics.date),
  });

  let since: string | undefined;
  if (latestRow) {
    // Use latest + 1 day as since
    const latestDate = new Date(latestRow.date);
    latestDate.setUTCDate(latestDate.getUTCDate() + 1);
    since = latestDate.toISOString().split("T")[0];
  }

  const metricsResponse = await fetchCopilotMetrics(
    token,
    connection.orgLogin,
    since
  );

  if (metricsResponse.error || !metricsResponse.data) {
    throw new Error(
      metricsResponse.error ?? "Failed to fetch Copilot usage metrics"
    );
  }

  const metrics = metricsResponse.data;

  for (const day of metrics) {
    const completions = day.copilot_ide_code_completions;

    // Sum totals from language arrays
    const totalSuggestions =
      completions?.languages?.reduce(
        (sum, l) => sum + l.total_code_suggestions,
        0
      ) ?? 0;
    const totalAcceptances =
      completions?.languages?.reduce(
        (sum, l) => sum + l.total_code_acceptances,
        0
      ) ?? 0;
    const totalLinesSuggested =
      completions?.languages?.reduce(
        (sum, l) => sum + l.total_code_lines_suggested,
        0
      ) ?? 0;
    const totalLinesAccepted =
      completions?.languages?.reduce(
        (sum, l) => sum + l.total_code_lines_accepted,
        0
      ) ?? 0;

    // Build language breakdown array
    const languageBreakdown =
      completions?.languages?.map((l) => ({
        language: l.name,
        suggestions: l.total_code_suggestions,
        acceptances: l.total_code_acceptances,
        linesSuggested: l.total_code_lines_suggested,
        linesAccepted: l.total_code_lines_accepted,
      })) ?? [];

    // Build editor breakdown from editors
    const editorBreakdown =
      completions?.editors?.map((e) => ({
        editor: e.name,
        engagedUsers: e.total_engaged_users,
        suggestions:
          e.models?.reduce((s, m) => s + m.total_code_suggestions, 0) ?? 0,
        acceptances:
          e.models?.reduce((s, m) => s + m.total_code_acceptances, 0) ?? 0,
      })) ?? [];

    await db
      .insert(copilotUsageMetrics)
      .values({
        connectionId: connection.id,
        date: day.date,
        totalActiveUsers: day.total_active_users,
        totalEngagedUsers: day.total_engaged_users,
        totalSuggestions,
        totalAcceptances,
        totalLinesSuggested,
        totalLinesAccepted,
        totalChatTurns: day.copilot_ide_chat?.total_turns ?? null,
        totalChatAcceptances: day.copilot_ide_chat?.total_acceptances ?? null,
        totalDotcomChatTurns: day.copilot_dotcom_chat?.total_turns ?? null,
        totalPrSummaries:
          day.copilot_dotcom_pull_requests?.total_pr_summaries_created ?? null,
        languageBreakdown,
        editorBreakdown,
      })
      .onConflictDoUpdate({
        target: [
          copilotUsageMetrics.connectionId,
          copilotUsageMetrics.date,
        ],
        set: {
          totalActiveUsers: day.total_active_users,
          totalEngagedUsers: day.total_engaged_users,
          totalSuggestions,
          totalAcceptances,
          totalLinesSuggested,
          totalLinesAccepted,
          totalChatTurns: day.copilot_ide_chat?.total_turns ?? null,
          totalChatAcceptances:
            day.copilot_ide_chat?.total_acceptances ?? null,
          totalDotcomChatTurns:
            day.copilot_dotcom_chat?.total_turns ?? null,
          totalPrSummaries:
            day.copilot_dotcom_pull_requests?.total_pr_summaries_created ??
            null,
          languageBreakdown,
          editorBreakdown,
        },
      });
  }

  return { metricsProcessed: metrics.length };
}

// ---------------------------------------------------------------------------
// Function 4: runCopilotSync
// ---------------------------------------------------------------------------

export async function runCopilotSync(
  connectionId: number,
  syncEventId: number
): Promise<void> {
  // Get connection by ID
  const connection = await db.query.githubConnections.findFirst({
    where: eq(githubConnections.id, connectionId),
  });

  if (!connection) {
    await db
      .update(githubSyncEvents)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: `Connection ${connectionId} not found`,
      })
      .where(eq(githubSyncEvents.id, syncEventId));
    return;
  }

  // Decrypt token
  let token: string;
  try {
    token = await decryptApiKey(connection.tokenEncrypted);
  } catch {
    await db
      .update(githubSyncEvents)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: "Failed to decrypt connection token",
      })
      .where(eq(githubSyncEvents.id, syncEventId));
    return;
  }

  const syncConnection: SyncConnection = {
    id: connection.id,
    orgLogin: connection.orgLogin,
    tokenEncrypted: connection.tokenEncrypted,
    copilotSyncEnabled: connection.copilotSyncEnabled,
  };

  const errors: string[] = [];
  let billingResult: BillingSyncResult | null = null;
  let seatResult: SeatSyncResult | null = null;
  let metricsResult: MetricsSyncResult | null = null;

  // Sync billing data
  try {
    billingResult = await syncBillingData(syncConnection, token);
  } catch (err) {
    errors.push(
      `Billing sync failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Sync seat assignments
  try {
    seatResult = await syncSeatAssignments(syncConnection, token);
  } catch (err) {
    errors.push(
      `Seat sync failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Sync usage metrics
  try {
    metricsResult = await syncUsageMetrics(syncConnection, token);
  } catch (err) {
    errors.push(
      `Metrics sync failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Determine final status
  const successCount = [billingResult, seatResult, metricsResult].filter(
    (r) => r !== null
  ).length;

  let finalStatus: "completed" | "partial" | "failed";
  if (successCount === 3) {
    finalStatus = "completed";
  } else if (successCount > 0) {
    finalStatus = "partial";
  } else {
    finalStatus = "failed";
  }

  // Update sync event
  await db
    .update(githubSyncEvents)
    .set({
      status: finalStatus,
      seatsProcessed: seatResult?.seatsProcessed ?? null,
      metricsProcessed: metricsResult?.metricsProcessed ?? null,
      billingProcessed: billingResult?.billingProcessed ?? null,
      completedAt: new Date(),
      errorMessage: errors.length > 0 ? errors.join("; ") : null,
    })
    .where(eq(githubSyncEvents.id, syncEventId));

  // Update connection lastSyncAt
  await db
    .update(githubConnections)
    .set({ lastSyncAt: new Date() })
    .where(eq(githubConnections.id, connectionId));
}
