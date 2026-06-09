/**
 * Server-only data loader for the Budget / Cost Forecast Simulation scenario
 * (spec 036). Assembles a {@link ForecastDataset} from live tables, mirroring
 * the conventions in `queries.ts`.
 *
 * Read-only. Tools are resolved by vendor + name (never hardcoded ids) so the
 * loader survives reseeded / per-environment databases — any tool that can't be
 * resolved is simply skipped. Per-period actuals come from the Budget Report
 * data layer, so completed-period figures match the Reports → Budget tab; the
 * current in-progress period is projected per tool rather than counted as a
 * partial actual (so "spent to date" trails the report by the open period).
 */

import { db } from "@/lib/db";
import {
  accessTiers,
  aiTools,
  copilotBillingSnapshots,
  githubConnections,
  licenseAssignments,
} from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getBudgetReportData } from "@/actions/reports";
import { getApiSubscriptionDataset } from "@/lib/scenarios/queries";
import type {
  ForecastDataset,
  ForecastPeriod,
  ForecastTool,
} from "@/lib/scenarios/budget-forecast";

// Tools are resolved by vendor + name rather than hardcoded ids.
const API_TOOL = { name: "Claude Console", vendor: "Anthropic" };
const CLAUDE_TOOL = { name: "Claude", vendor: "Anthropic" };
const COPILOT_TOOL = { name: "GitHub Copilot", vendor: "GitHub" };
const CURSOR_TOOL = { name: "Cursor", vendor: "Anysphere" };
const MSCOPILOT_TOOL = { name: "Microsoft Copilot", vendor: "Microsoft" };

/** `'YYYY-MM-DD'` for the current UTC day, for elapsed-period comparison. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

type ToolRow = { id: number; name: string; vendor: string };

function findTool(
  tools: ToolRow[],
  spec: { name: string; vendor: string },
): ToolRow | undefined {
  return tools.find((t) => t.name === spec.name && t.vendor === spec.vendor);
}

/** Count of active license assignments for a tool. */
async function activeAssignmentCount(toolId: number): Promise<number> {
  const rows = await db
    .select({ id: licenseAssignments.id })
    .from(licenseAssignments)
    .where(
      and(
        eq(licenseAssignments.toolId, toolId),
        eq(licenseAssignments.status, "active"),
      ),
    );
  return rows.length;
}

/** Lowest-cost active tier price (cents) for a tool, or undefined. */
async function lowestActiveTierCents(
  toolId: number,
): Promise<number | undefined> {
  const tiers = await db
    .select({ cents: accessTiers.monthlyCostCents })
    .from(accessTiers)
    .where(and(eq(accessTiers.toolId, toolId), eq(accessTiers.isActive, true)));
  if (tiers.length === 0) return undefined;
  return Math.min(...tiers.map((t) => t.cents));
}

/** Active tier price (cents) matching a name regex for a tool, or undefined. */
async function tierCentsByName(
  toolId: number,
  pattern: RegExp,
): Promise<number | undefined> {
  const tiers = await db
    .select({ name: accessTiers.name, cents: accessTiers.monthlyCostCents })
    .from(accessTiers)
    .where(and(eq(accessTiers.toolId, toolId), eq(accessTiers.isActive, true)));
  return tiers.find((t) => pattern.test(t.name))?.cents;
}

/**
 * Assemble the full dataset for the Budget / Cost Forecast Simulation.
 * Read-only; no schema dependencies beyond the existing columns.
 */
export async function getBudgetForecastDataset(): Promise<ForecastDataset> {
  const generatedAt = new Date().toISOString();

  // 1. Budget + per-period actuals come from the Budget Report data layer.
  const report = await getBudgetReportData();
  if (report.kind === "empty") {
    return {
      liveCeilingCents: 0,
      fiscalYear: new Date().getUTCFullYear(),
      periods: [],
      lastElapsedIndex: -1,
      tools: [],
      generatedAt,
    };
  }

  const { budget, periodsWithActual } = report;

  // 2. One forecast period per budget period (already ordered by periodIndex).
  const today = todayUtc();
  let lastElapsedIndex = -1;
  const periods: ForecastPeriod[] = periodsWithActual.map((p, i) => {
    // endDate is a `date` column ('YYYY-MM-DD'); elapsed = strictly before today (UTC).
    const elapsed = p.endDate < today;
    if (elapsed) lastElapsedIndex = i;
    return {
      label: p.periodLabel,
      plannedCents: p.plannedAmountCents,
      actualCents: p.actualCents,
      elapsed,
    };
  });

  // 3. Resolve each canonical tool by vendor + name; skip any not found.
  const toolRows = await db
    .select({ id: aiTools.id, name: aiTools.name, vendor: aiTools.vendor })
    .from(aiTools);

  const tools: ForecastTool[] = [];

  // 3a. 'api' (metered) — Claude Console · API. Reuse the API → Subscription
  //     dataset for seats0 (user count) and burn0 (avg spend / user / month).
  const apiTool = findTool(toolRows, API_TOOL);
  if (apiTool) {
    const apiDs = await getApiSubscriptionDataset();
    const userCount = apiDs.users.length;
    const months = apiDs.completeMonths;
    // Per-user average across complete months, summed, then divided by the
    // user count so burn0 is "cents per user per period".
    const sumOfUserAverages = apiDs.users.reduce((acc, u) => {
      if (months.length === 0) return acc;
      const userSum = months.reduce((s, mo) => s + (u.monthly[mo] ?? 0), 0);
      return acc + userSum / months.length;
    }, 0);
    const burn0 = Math.round(sumOfUserAverages / Math.max(1, userCount));
    tools.push({
      key: "api",
      label: "Claude Console · API",
      vendor: API_TOOL.vendor,
      kind: "metered",
      seats0: userCount,
      burn0,
    });
  }

  // 3b. 'claude' (claudeSeats) — Claude · seats.
  const claudeTool = findTool(toolRows, CLAUDE_TOOL);
  if (claudeTool) {
    const [activeRows, tiers] = await Promise.all([
      db
        .select({ tierId: licenseAssignments.tierId })
        .from(licenseAssignments)
        .where(
          and(
            eq(licenseAssignments.toolId, claudeTool.id),
            eq(licenseAssignments.status, "active"),
          ),
        ),
      db
        .select({ id: accessTiers.id, cents: accessTiers.monthlyCostCents })
        .from(accessTiers)
        .where(
          and(
            eq(accessTiers.toolId, claudeTool.id),
            eq(accessTiers.isActive, true),
          ),
        ),
    ]);
    const seats0 = activeRows.length;

    let stdPrice: number | undefined;
    let premPrice: number | undefined;
    let premShare0 = 0;
    if (tiers.length > 0) {
      // By design the "claudeSeats" kind collapses an N-tier table to a
      // Standard (lowest-cost) / Premium (highest-cost) pair, modelled by a
      // single Premium share; any middle tiers fold into one of the two by cost.
      const byCost = [...tiers].sort((a, b) => a.cents - b.cents);
      const lowest = byCost[0];
      const highest = byCost[byCost.length - 1];
      stdPrice = lowest.cents;
      premPrice = highest.cents;
      // Active assignments sitting on the premium (highest) tier.
      const premiumAssignments = activeRows.filter(
        (r) => r.tierId === highest.id,
      ).length;
      premShare0 = premiumAssignments / Math.max(1, seats0);
    }

    tools.push({
      key: "claude",
      label: "Claude · seats",
      vendor: CLAUDE_TOOL.vendor,
      kind: "claudeSeats",
      seats0,
      stdPrice,
      premPrice,
      premShare0,
    });
  }

  // 3c. 'copilot' (seat) — prefer the latest billing snapshot, else fall back
  //     to active assignment count + the Business tier price.
  const copilotTool = findTool(toolRows, COPILOT_TOOL);
  if (copilotTool) {
    // Only active connections, summing the latest snapshot PER connection — so a
    // multi-org setup isn't collapsed to a single org and a revoked/stale
    // connection can't be the one picked.
    const connections = await db
      .select({ id: githubConnections.id })
      .from(githubConnections)
      .where(eq(githubConnections.status, "active"));

    const snapshots = await Promise.all(
      connections.map((conn) =>
        db
          .select({
            totalSeats: copilotBillingSnapshots.totalSeats,
            seatCostCents: copilotBillingSnapshots.seatCostCents,
          })
          .from(copilotBillingSnapshots)
          .where(eq(copilotBillingSnapshots.connectionId, conn.id))
          .orderBy(desc(copilotBillingSnapshots.billingMonth))
          .limit(1)
          .then((rows) => rows[0]),
      ),
    );

    let totalSeats = 0;
    let totalCostCents = 0;
    let lastSeatCost = 0;
    let hasSnapshot = false;
    for (const snap of snapshots) {
      if (snap) {
        hasSnapshot = true;
        totalSeats += snap.totalSeats;
        totalCostCents += snap.totalSeats * snap.seatCostCents;
        lastSeatCost = snap.seatCostCents;
      }
    }

    let seats0: number;
    let price: number;
    if (hasSnapshot) {
      seats0 = totalSeats;
      // Blended seat price across orgs (purchased seats drive the bill).
      price =
        totalSeats > 0 ? Math.round(totalCostCents / totalSeats) : lastSeatCost;
    } else {
      seats0 = await activeAssignmentCount(copilotTool.id);
      price = (await tierCentsByName(copilotTool.id, /business/i)) ?? 0;
    }

    tools.push({
      key: "copilot",
      label: "GitHub Copilot",
      vendor: COPILOT_TOOL.vendor,
      kind: "seat",
      seats0,
      price,
    });
  }

  // 3d. 'cursor' (seat) — active assignments + "Member" tier price.
  const cursorTool = findTool(toolRows, CURSOR_TOOL);
  if (cursorTool) {
    const [seats0, priceMatch] = await Promise.all([
      activeAssignmentCount(cursorTool.id),
      tierCentsByName(cursorTool.id, /member/i),
    ]);
    const price = priceMatch ?? 0;
    tools.push({
      key: "cursor",
      label: "Cursor",
      vendor: CURSOR_TOOL.vendor,
      kind: "seat",
      seats0,
      price,
    });
  }

  // 3e. 'mscopilot' (seat) — active assignments + its tier price (likely 0).
  const msTool = findTool(toolRows, MSCOPILOT_TOOL);
  if (msTool) {
    const [seats0, priceMatch] = await Promise.all([
      activeAssignmentCount(msTool.id),
      lowestActiveTierCents(msTool.id),
    ]);
    const price = priceMatch ?? 0;
    tools.push({
      key: "mscopilot",
      label: "Microsoft Copilot",
      vendor: MSCOPILOT_TOOL.vendor,
      kind: "seat",
      seats0,
      price,
    });
  }

  // 4. Budget-level fields.
  return {
    liveCeilingCents: budget.totalAmountCents,
    fiscalYear: budget.fiscalYear,
    periods,
    lastElapsedIndex,
    tools,
    generatedAt,
  };
}
