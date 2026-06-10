import { db } from "@/lib/db";
import {
  accessTiers,
  aiTools,
  anthropicUsageMetrics,
  licenseAssignments,
  users,
} from "@/lib/db/schema";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { classifyMonths } from "./api-subscription";
import type { ApiSubscriptionDataset, ApiUser } from "./types";

// Tools are resolved by vendor + name rather than hardcoded ids so the loader
// survives reseeded / per-environment databases.
const ANTHROPIC = "Anthropic";
const API_TOOL_NAME = "Claude Console"; // assignments here carry the API keys
const SEAT_TOOL_NAME = "Claude"; // its access_tiers are the Standard/Premium seats

const FALLBACK_STANDARD_CENTS = 2500;
const FALLBACK_PREMIUM_CENTS = 12500;

function emptyDataset(
  defaultStandardCents = FALLBACK_STANDARD_CENTS,
  defaultPremiumCents = FALLBACK_PREMIUM_CENTS,
): ApiSubscriptionDataset {
  return {
    users: [],
    completeMonths: [],
    partialMonths: [],
    defaultStandardCents,
    defaultPremiumCents,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Assemble the full dataset for the API → Subscription calculator from live
 * tables. Read-only; no schema dependencies beyond the existing columns.
 */
export async function getApiSubscriptionDataset(): Promise<ApiSubscriptionDataset> {
  // 1. Resolve the two Anthropic tools.
  const tools = await db
    .select({ id: aiTools.id, name: aiTools.name })
    .from(aiTools)
    .where(eq(aiTools.vendor, ANTHROPIC));

  const apiTool = tools.find((t) => t.name === API_TOOL_NAME);
  const seatTool = tools.find((t) => t.name === SEAT_TOOL_NAME);

  // 2. Seat-price defaults from the subscription tool's active tiers. Match by
  //    name ("Standard" / "Premium") so a third tier or a price inversion can't
  //    silently mis-pick; fall back to lowest=Standard / highest=Premium by cost.
  let defaultStandardCents = FALLBACK_STANDARD_CENTS;
  let defaultPremiumCents = FALLBACK_PREMIUM_CENTS;
  if (seatTool) {
    const seatTiers = await db
      .select({ name: accessTiers.name, cents: accessTiers.monthlyCostCents })
      .from(accessTiers)
      .where(
        and(
          eq(accessTiers.toolId, seatTool.id),
          eq(accessTiers.isActive, true),
        ),
      );
    if (seatTiers.length > 0) {
      const byCost = [...seatTiers].sort((a, b) => a.cents - b.cents);
      const standard = seatTiers.find((t) => /standard/i.test(t.name));
      const premium = seatTiers.find((t) => /premium/i.test(t.name));
      defaultStandardCents = standard?.cents ?? byCost[0].cents;
      defaultPremiumCents = premium?.cents ?? byCost[byCost.length - 1].cents;
    }
  }

  if (!apiTool) return emptyDataset(defaultStandardCents, defaultPremiumCents);

  // 3. API users = Claude Console assignments that carry an API key.
  const assignmentRows = await db
    .select({
      userId: licenseAssignments.userId,
      status: licenseAssignments.status,
      workspace: licenseAssignments.workspace,
      assignedAt: licenseAssignments.assignedAt,
      tierName: accessTiers.name,
      name: users.name,
      email: users.email,
      discipline: users.discipline,
    })
    .from(licenseAssignments)
    .innerJoin(accessTiers, eq(accessTiers.id, licenseAssignments.tierId))
    .innerJoin(users, eq(users.id, licenseAssignments.userId))
    .where(
      and(
        eq(licenseAssignments.toolId, apiTool.id),
        isNotNull(licenseAssignments.apiKeyEncrypted),
      ),
    );

  if (assignmentRows.length === 0) {
    return emptyDataset(defaultStandardCents, defaultPremiumCents);
  }

  // One assignment per user: prefer active, then most-recently assigned.
  const byUser = new Map<number, (typeof assignmentRows)[number]>();
  for (const row of assignmentRows) {
    const existing = byUser.get(row.userId);
    if (!existing) {
      byUser.set(row.userId, row);
      continue;
    }
    const rank =
      (row.status === "active" ? 1 : 0) -
        (existing.status === "active" ? 1 : 0) ||
      row.assignedAt.getTime() - existing.assignedAt.getTime();
    if (rank > 0) byUser.set(row.userId, row);
  }
  const userIds = [...byUser.keys()];

  // 4. Per-user monthly spend + earliest usage date.
  const usageRows = await db
    .select({
      userId: anthropicUsageMetrics.userId,
      month: sql<string>`to_char(${anthropicUsageMetrics.date}, 'YYYY-MM')`,
      cents: sql<number>`sum(${anthropicUsageMetrics.computedCostCents})::int`,
    })
    .from(anthropicUsageMetrics)
    .where(inArray(anthropicUsageMetrics.userId, userIds))
    .groupBy(
      anthropicUsageMetrics.userId,
      sql`to_char(${anthropicUsageMetrics.date}, 'YYYY-MM')`,
    );

  const minRows = await db
    .select({ minDate: sql<string | null>`min(${anthropicUsageMetrics.date})` })
    .from(anthropicUsageMetrics)
    .where(inArray(anthropicUsageMetrics.userId, userIds));
  const minDate = minRows[0]?.minDate ?? null;

  const monthlyByUser = new Map<number, Record<string, number>>();
  const allMonths = new Set<string>();
  for (const r of usageRows) {
    allMonths.add(r.month);
    const map = monthlyByUser.get(r.userId) ?? {};
    map[r.month] = Number(r.cents) || 0;
    monthlyByUser.set(r.userId, map);
  }

  // 5. Classify months into complete vs partial (see classifyMonths).
  const months = [...allMonths].sort();
  const currentMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM' (UTC)
  const { completeMonths, partialMonths } = classifyMonths(
    months,
    minDate,
    currentMonth,
  );

  // 6. Build the user list, sorted by avg-complete-month spend desc for a
  //    deterministic SSR order (the client re-sorts on demand).
  const avgComplete = (monthly: Record<string, number>) =>
    completeMonths.length
      ? completeMonths.reduce((s, mo) => s + (monthly[mo] ?? 0), 0) /
        completeMonths.length
      : 0;

  const userList: ApiUser[] = userIds
    .map((id) => {
      const a = byUser.get(id)!;
      return {
        userId: id,
        name: a.name,
        email: a.email,
        discipline: a.discipline ?? null,
        status: a.status === "active" ? "active" : "inactive",
        workspace: a.workspace ?? null,
        internalTier: a.tierName ?? null,
        monthly: monthlyByUser.get(id) ?? {},
      } satisfies ApiUser;
    })
    .sort((x, y) => avgComplete(y.monthly) - avgComplete(x.monthly));

  return {
    users: userList,
    completeMonths,
    partialMonths,
    defaultStandardCents,
    defaultPremiumCents,
    generatedAt: new Date().toISOString(),
  };
}
