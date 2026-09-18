import "server-only";

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

/**
 * Measured consumption per tool per month, for usage-based pricing.
 *
 * "Measured" means Anthropic's billed cost (P4) — not the token-derived
 * estimate, and not invoice totals. Invoices for a prepaid tool are credit
 * purchases landing on dates unrelated to the consumption they fund, so
 * summing them would answer a different question.
 *
 * Only Anthropic API access is usage-based today. A tool qualifies by having
 * at least one `usage` tier, so adding a second metered vendor is a matter of
 * teaching this function where that vendor's billed cost lives — not of
 * changing any caller.
 */
export async function getMeasuredConsumptionByMonth(): Promise<
  Map<number, Map<string, number>>
> {
  const usageTools = (
    await db.execute(sql`
      SELECT DISTINCT t.id, t.vendor
      FROM ai_tools t
      JOIN access_tiers ac ON ac.tool_id = t.id
      WHERE ac.pricing_model = 'usage'
    `)
  ).rows as { id: number; vendor: string }[];

  const result = new Map<number, Map<string, number>>();
  if (usageTools.length === 0) return result;

  const anthropicToolIds = usageTools
    .filter((t) => t.vendor === "Anthropic")
    .map((t) => t.id);

  if (anthropicToolIds.length > 0) {
    // Org-wide billed cost, including workspaces attributed to nobody: this is
    // what the TOOL consumed, which is the budget's question. Per-user
    // attribution answers a different one.
    const rows = (
      await db.execute(sql`
        SELECT to_char(date, 'YYYY-MM') AS month, SUM(cost_cents)::bigint AS cents
        FROM anthropic_workspace_costs
        GROUP BY 1
        ORDER BY 1
      `)
    ).rows as { month: string; cents: string }[];

    const byMonth = new Map(rows.map((r) => [r.month, Number(r.cents)]));
    for (const toolId of anthropicToolIds) {
      result.set(toolId, byMonth);
    }
  }

  return result;
}

/** The YYYY-MM months a period spans, inclusive. */
export function monthsInPeriod(start: Date, end: Date): string[] {
  const months: string[] = [];
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  );
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));

  while (cursor <= last) {
    months.push(
      `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`,
    );
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return months;
}
