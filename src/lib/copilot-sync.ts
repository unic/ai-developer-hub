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
import { eq, and, sql, desc, isNull, between, lte, gte } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SyncConnection {
  id: number;
  orgLogin: string;
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
    } else if (tier.monthlyCostCents !== costCents) {
      await db
        .update(accessTiers)
        .set({ monthlyCostCents: costCents, updatedAt: new Date() })
        .where(eq(accessTiers.id, tier.id));
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

  // Batch-fetch ALL assignments for this tool (any source) to avoid duplicates
  const allToolAssignments = await db.query.licenseAssignments.findMany({
    where: eq(licenseAssignments.toolId, tool.id),
  });
  const assignmentByUserId = new Map<number, typeof allToolAssignments[number]>();
  for (const a of allToolAssignments) {
    // Prefer copilot-sync over manual if both somehow exist
    const existing = assignmentByUserId.get(a.userId);
    if (!existing || (existing.source === "manual" && a.source === "copilot-sync")) {
      assignmentByUserId.set(a.userId, a);
    }
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
    const existing = assignmentByUserId.get(userId);

    if (existing) {
      // Take over manual assignments — sync becomes the source of truth
      const needsSourceUpdate = existing.source !== "copilot-sync";
      const needsTierUpdate = existing.tierId !== tier.id;
      const needsReactivate = existing.status === "inactive" && isActive;

      if (needsSourceUpdate || needsTierUpdate || needsReactivate) {
        await db
          .update(licenseAssignments)
          .set({
            source: "copilot-sync",
            workspace: connection.orgLogin,
            tierId: tier.id,
            costAtAssignmentCents: tier.monthlyCostCents,
            ...(needsReactivate && {
              status: "active" as const,
              revokedAt: null,
              assignedAt: new Date(),
            }),
            updatedAt: new Date(),
          })
          .where(eq(licenseAssignments.id, existing.id));
      }
    } else if (isActive) {
      // No existing assignment at all — create new
      await db.insert(licenseAssignments).values({
        userId,
        toolId: tool.id,
        tierId: tier.id,
        costAtAssignmentCents: tier.monthlyCostCents,
        status: "active",
        source: "copilot-sync",
        workspace: connection.orgLogin,
      });
    }
  }

  // Revoke removed seats (only copilot-sync managed assignments)
  for (const assignment of allToolAssignments) {
    if (
      assignment.source === "copilot-sync" &&
      assignment.status === "active" &&
      !activeUserIds.has(assignment.userId)
    ) {
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

    // Aggregate language metrics from editors[].models[].languages[]
    // (the top-level languages[] only has name + engaged_users, no counts)
    const langTotals = new Map<
      string,
      { suggestions: number; acceptances: number; linesSuggested: number; linesAccepted: number }
    >();

    let totalSuggestions = 0;
    let totalAcceptances = 0;
    let totalLinesSuggested = 0;
    let totalLinesAccepted = 0;

    for (const editor of completions?.editors ?? []) {
      for (const model of editor.models ?? []) {
        for (const lang of model.languages ?? []) {
          totalSuggestions += lang.total_code_suggestions ?? 0;
          totalAcceptances += lang.total_code_acceptances ?? 0;
          totalLinesSuggested += lang.total_code_lines_suggested ?? 0;
          totalLinesAccepted += lang.total_code_lines_accepted ?? 0;

          const existing = langTotals.get(lang.name);
          if (existing) {
            existing.suggestions += lang.total_code_suggestions ?? 0;
            existing.acceptances += lang.total_code_acceptances ?? 0;
            existing.linesSuggested += lang.total_code_lines_suggested ?? 0;
            existing.linesAccepted += lang.total_code_lines_accepted ?? 0;
          } else {
            langTotals.set(lang.name, {
              suggestions: lang.total_code_suggestions ?? 0,
              acceptances: lang.total_code_acceptances ?? 0,
              linesSuggested: lang.total_code_lines_suggested ?? 0,
              linesAccepted: lang.total_code_lines_accepted ?? 0,
            });
          }
        }
      }
    }

    const languageBreakdown = [...langTotals.entries()].map(
      ([language, totals]) => ({
        language,
        ...totals,
      })
    );

    // Build editor breakdown by summing across models[].languages[]
    const editorBreakdown =
      completions?.editors?.map((e) => {
        let suggestions = 0;
        let acceptances = 0;
        for (const m of e.models ?? []) {
          for (const l of m.languages ?? []) {
            suggestions += l.total_code_suggestions ?? 0;
            acceptances += l.total_code_acceptances ?? 0;
          }
        }
        return {
          editor: e.name,
          engagedUsers: e.total_engaged_users,
          suggestions,
          acceptances,
        };
      }) ?? [];

    // Aggregate chat metrics from editors[].models[]
    let totalChatTurns = 0;
    let totalChatAcceptances = 0;
    let hasChatData = false;
    for (const editor of day.copilot_ide_chat?.editors ?? []) {
      for (const model of editor.models ?? []) {
        hasChatData = true;
        totalChatTurns += model.total_chats ?? 0;
        totalChatAcceptances += model.total_chat_insertion_events ?? 0;
      }
    }

    // Aggregate dotcom chat from models[]
    let totalDotcomChatTurns = 0;
    let hasDotcomChat = false;
    for (const model of day.copilot_dotcom_chat?.models ?? []) {
      hasDotcomChat = true;
      totalDotcomChatTurns += model.total_chats ?? 0;
    }

    // Aggregate PR summaries from repositories[].models[]
    let totalPrSummaries = 0;
    let hasPrData = false;
    for (const repo of day.copilot_dotcom_pull_requests?.repositories ?? []) {
      for (const model of repo.models ?? []) {
        hasPrData = true;
        totalPrSummaries += model.total_pr_summaries_created ?? 0;
      }
    }

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
        totalChatTurns: hasChatData ? totalChatTurns : null,
        totalChatAcceptances: hasChatData ? totalChatAcceptances : null,
        totalDotcomChatTurns: hasDotcomChat ? totalDotcomChatTurns : null,
        totalPrSummaries: hasPrData ? totalPrSummaries : null,
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
          totalChatTurns: hasChatData ? totalChatTurns : null,
          totalChatAcceptances: hasChatData ? totalChatAcceptances : null,
          totalDotcomChatTurns: hasDotcomChat ? totalDotcomChatTurns : null,
          totalPrSummaries: hasPrData ? totalPrSummaries : null,
          languageBreakdown,
          editorBreakdown,
        },
      });
  }

  return { metricsProcessed: metrics.length };
}

// ---------------------------------------------------------------------------
// Function 4: backfillBilledCosts
// ---------------------------------------------------------------------------

export async function backfillBilledCosts(
  connectionId: number
): Promise<number> {
  // Find unlinked billing snapshots for this connection
  const unlinked = await db
    .select()
    .from(copilotBillingSnapshots)
    .where(
      and(
        eq(copilotBillingSnapshots.connectionId, connectionId),
        isNull(copilotBillingSnapshots.linkedBilledCostId)
      )
    );

  let backfilledCount = 0;

  for (const snapshot of unlinked) {
    // Find matching budget period where startDate <= billingMonth <= endDate
    const period = await db.query.budgetPeriods.findFirst({
      where: and(
        lte(budgetPeriods.startDate, snapshot.billingMonth),
        gte(budgetPeriods.endDate, snapshot.billingMonth)
      ),
    });

    if (!period) continue;

    // Check if we already have a billedCost for this vendor reference
    const vendorRef = `copilot-billing-${snapshot.billingMonth}`;
    const existing = await db.query.billedCosts.findFirst({
      where: eq(billedCosts.vendorReference, vendorRef),
    });

    if (existing) continue;

    // Create billedCost entry
    const [cost] = await db
      .insert(billedCosts)
      .values({
        periodId: period.id,
        amountCents: snapshot.totalCostCents,
        invoiceDate: snapshot.billingMonth,
        description: `GitHub Copilot - ${snapshot.billingMonth}`,
        vendorReference: vendorRef,
      })
      .returning({ id: billedCosts.id });

    // Update snapshot with link
    await db
      .update(copilotBillingSnapshots)
      .set({ linkedBilledCostId: cost.id, updatedAt: new Date() })
      .where(eq(copilotBillingSnapshots.id, snapshot.id));

    backfilledCount++;
  }

  return backfilledCount;
}

// ---------------------------------------------------------------------------
// Function 5: runCopilotSync
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

  // Backfill any unlinked billing snapshots to budget periods
  try {
    await backfillBilledCosts(connectionId);
  } catch {
    // Backfill is best-effort; don't fail the sync
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
