import { db } from "@/lib/db";
import {
  aiTools,
  accessTiers,
  licenseAssignments,
  githubProfiles,
  copilotUsageMetrics,
  copilotBillingSnapshots,
} from "@/lib/db/schema";
import {
  fetchCopilotBilling,
  fetchCopilotSeats,
  fetchCopilotOrgDayReport,
  fetchCopilotUsersDayReport,
  downloadReportNdjson,
  type CopilotMetricsRow,
} from "@/lib/copilot-api";
import { eq, and } from "drizzle-orm";

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
  token: string,
): Promise<BillingSyncResult> {
  const billingResponse = await fetchCopilotBilling(token, connection.orgLogin);

  if (billingResponse.error || !billingResponse.data) {
    throw new Error(
      billingResponse.error ?? "Failed to fetch Copilot billing data",
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
        eq(accessTiers.name, tierName),
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
  token: string,
): Promise<SeatSyncResult> {
  const seatsResponse = await fetchCopilotSeats(token, connection.orgLogin);

  if (seatsResponse.error || !seatsResponse.data) {
    throw new Error(
      seatsResponse.error ?? "Failed to fetch Copilot seat assignments",
    );
  }

  const seats = seatsResponse.data;

  // Get the GitHub Copilot tool
  const tool = await db.query.aiTools.findFirst({
    where: eq(aiTools.name, "GitHub Copilot"),
  });

  if (!tool) {
    throw new Error(
      "GitHub Copilot tool not found. Run syncBillingData first.",
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
  const tierByName = new Map<string, (typeof tiers)[number]>();
  for (const tier of tiers) {
    tierByName.set(tier.name, tier);
  }

  // Batch-fetch ALL assignments for this tool (any source) to avoid duplicates
  const allToolAssignments = await db.query.licenseAssignments.findMany({
    where: eq(licenseAssignments.toolId, tool.id),
  });
  const assignmentByUserId = new Map<
    number,
    (typeof allToolAssignments)[number]
  >();
  for (const a of allToolAssignments) {
    // Prefer copilot-sync over manual if both somehow exist
    const existing = assignmentByUserId.get(a.userId);
    if (
      !existing ||
      (existing.source === "manual" && a.source === "copilot-sync")
    ) {
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

/**
 * Number of UTC days before today that we wait before trusting a daily report.
 * GitHub finalizes Copilot usage data within ~3 days; days more recent than
 * `today - FINALIZATION_LAG_DAYS` are not yet stable.
 *
 * https://docs.github.com/en/copilot/reference/copilot-usage-metrics/reconciling-usage-metrics
 */
const FINALIZATION_LAG_DAYS = 3;

/**
 * How many additional days to re-fetch behind `FINALIZATION_LAG_DAYS` on each
 * regular run. Catches late-arriving telemetry rows; idempotent upserts make
 * the re-fetch a no-op when nothing changed.
 */
const RESTABILIZE_WINDOW_DAYS = 4;

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addUtcDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function daysInRange(start: Date, end: Date): string[] {
  const out: string[] = [];
  for (let cur = new Date(start); cur <= end; cur = addUtcDays(cur, 1)) {
    out.push(utcDay(cur));
  }
  return out;
}

/**
 * Map one NDJSON row from the org-1-day report onto a row of
 * `copilot_usage_metrics`. Exported for unit testing.
 *
 * `activeUsers` and `engagedUsers` come from a separate users-1-day fetch
 * (the org-level report does not expose them as flat counters), supplied by
 * the caller.
 */
export function mapNdjsonRowToDbRow(
  connectionId: number,
  date: string,
  row: CopilotMetricsRow,
  userCounts: { active: number; engaged: number },
) {
  const chatModeKeys = [
    "chat_panel_agent_mode",
    "chat_panel_ask_mode",
    "chat_panel_edit_mode",
    "chat_panel_plan_mode",
    "chat_panel_custom_mode",
    "chat_panel_unknown_mode",
  ] as const;
  const hasChatData = chatModeKeys.some((k) => row[k] !== undefined);
  const chatTurns = chatModeKeys.reduce(
    (sum, k) => sum + ((row[k] as number | undefined) ?? 0),
    0,
  );

  return {
    connectionId,
    date,
    totalActiveUsers: userCounts.active,
    totalEngagedUsers: userCounts.engaged,
    totalSuggestions: row.code_generation_activity_count ?? 0,
    totalAcceptances: row.code_acceptance_activity_count ?? 0,
    totalLinesSuggested: row.loc_suggested_to_add_sum ?? 0,
    totalLinesAccepted: row.loc_added_sum ?? 0,
    totalChatTurns: hasChatData ? chatTurns : null,
    totalChatAcceptances: null,
    // GitHub removed these on 2026-04-02; written as null going forward.
    totalDotcomChatTurns: null,
    totalPrSummaries: null,
    languageBreakdown: row.totals_by_language_feature ?? null,
    editorBreakdown: row.totals_by_ide ?? null,
    usedCli: row.totals_by_cli !== undefined,
    usedAgent:
      (row.chat_panel_agent_mode ?? 0) > 0 || (row.agent_edit ?? 0) > 0,
    agentEditCount: row.agent_edit ?? null,
    cliBreakdown: row.totals_by_cli ?? null,
  };
}

/**
 * When `backfillStartDate` is set, sync every UTC day from that date through
 * today minus the finalization lag. When unset, sync the rolling restabilization
 * window: `today − (FINALIZATION_LAG_DAYS + RESTABILIZE_WINDOW_DAYS)` through
 * `today − FINALIZATION_LAG_DAYS`.
 */
export async function syncUsageMetrics(
  connection: SyncConnection,
  token: string,
  opts: { backfillStartDate?: Date } = {},
): Promise<MetricsSyncResult> {
  const newest = addUtcDays(new Date(), -FINALIZATION_LAG_DAYS);
  const oldest = opts.backfillStartDate
    ? new Date(opts.backfillStartDate)
    : addUtcDays(newest, -RESTABILIZE_WINDOW_DAYS);
  const targetDays = daysInRange(oldest, newest);

  let processed = 0;

  for (const day of targetDays) {
    const orgMeta = await fetchCopilotOrgDayReport(
      token,
      connection.orgLogin,
      day,
    );

    if (orgMeta.error) {
      throw new Error(
        `Copilot org-day report failed for ${day}: ${orgMeta.error}`,
      );
    }
    // 204 No Content or empty links means GitHub hasn't generated a report for
    // this day yet; that's expected behind the finalization lag.
    if (
      orgMeta.status === 204 ||
      !orgMeta.data ||
      !orgMeta.data.download_links?.length
    ) {
      continue;
    }

    const orgRows: CopilotMetricsRow[] = [];
    for (const link of orgMeta.data.download_links) {
      orgRows.push(...(await downloadReportNdjson(link)));
    }
    if (orgRows.length === 0) continue;
    const orgRow = orgRows[0];

    // Per-user counts come from the users-1-day report. Required to keep the
    // schema's NOT NULL invariant on `total_active_users` / `total_engaged_users`.
    const usersMeta = await fetchCopilotUsersDayReport(
      token,
      connection.orgLogin,
      day,
    );
    let userCounts = { active: 0, engaged: 0 };
    if (usersMeta.data?.download_links?.length) {
      const userRows: CopilotMetricsRow[] = [];
      for (const link of usersMeta.data.download_links) {
        userRows.push(...(await downloadReportNdjson(link)));
      }
      userCounts = {
        active: userRows.length,
        engaged: userRows.filter(
          (r) => (r.user_initiated_interaction_count ?? 0) > 0,
        ).length,
      };
    }

    const mapped = mapNdjsonRowToDbRow(connection.id, day, orgRow, userCounts);
    await db
      .insert(copilotUsageMetrics)
      .values(mapped)
      .onConflictDoUpdate({
        target: [copilotUsageMetrics.connectionId, copilotUsageMetrics.date],
        set: mapped,
      });
    processed++;
  }

  return { metricsProcessed: processed };
}

