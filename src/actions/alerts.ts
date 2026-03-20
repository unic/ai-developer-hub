"use server";

import { db } from "@/lib/db";
import { unstable_cache } from "next/cache";
import { sql } from "drizzle-orm";
import { format, endOfMonth, parseISO } from "date-fns";
import type { ActiveAlertsData, WorkspaceAlert } from "@/types";

async function computeActiveAlerts(): Promise<ActiveAlertsData> {
  const currentMonth = format(new Date(), "yyyy-MM");
  const startDate = `${currentMonth}-01`;
  const endDate = format(endOfMonth(parseISO(`${currentMonth}-01`)), "yyyy-MM-dd");

  const rows = await db.execute(sql`
    SELECT
      w.workspace_id,
      w.name,
      COALESCE(c.total_cents, 0) as current_month_cents,
      l.limit_cents
    FROM anthropic_workspaces w
    LEFT JOIN (
      SELECT workspace_id, SUM(cost_cents) as total_cents
      FROM anthropic_workspace_costs
      WHERE date >= ${startDate}::date AND date <= ${endDate}::date
      GROUP BY workspace_id
    ) c ON c.workspace_id IS NOT DISTINCT FROM w.workspace_id
    LEFT JOIN anthropic_workspace_limits l
      ON l.workspace_id IS NOT DISTINCT FROM w.workspace_id
    WHERE w.is_archived = false
  `);

  const workspaceAlerts: WorkspaceAlert[] = [];

  for (const row of rows.rows) {
    const limitCents = row.limit_cents as number | null;
    const currentMonthCents = row.current_month_cents as number;

    if (limitCents === null || limitCents <= 0) continue;

    const utilizationPct = Math.round((currentMonthCents / limitCents) * 100);
    if (utilizationPct >= 80) {
      workspaceAlerts.push({
        workspaceId: row.workspace_id as string | null,
        name: row.name as string,
        utilizationPct,
        severity: utilizationPct >= 100 ? "critical" : "warning",
      });
    }
  }

  return {
    workspaceAlerts,
    creditsLow: false,
    creditsCritical: false,
  };
}

export const getActiveAlerts = unstable_cache(
  computeActiveAlerts,
  ["active-alerts"],
  { tags: ["alerts"], revalidate: 300 } // 5-minute TTL
);
