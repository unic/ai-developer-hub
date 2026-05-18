"use client";

import { TwelveMonthBarChart } from "@/components/claude/twelve-month-bar-chart";
import type { TwelveMonthRow } from "@/types";

/**
 * Per-user 12-month bar chart.
 *
 * Thin wrapper around the spec-026 `TwelveMonthBarChart` primitive. The org
 * primitive renders a reference line for the org billing budget — that's
 * meaningless at the per-user level (Anthropic doesn't expose per-user caps,
 * and spec 027 explicitly defers per-user budget limits), so we strip the cap
 * by setting `budgetLimitCents: null` on every row before forwarding.
 *
 * No chart code is duplicated — the shared primitive owns the rendering.
 */
export function UserTwelveMonthBarChart({
  rows,
  currentMonth,
  projectedMonthEndCents,
}: {
  rows: { month: string; totalCents: number }[];
  currentMonth: string;
  projectedMonthEndCents: number;
}) {
  const wrapped: TwelveMonthRow[] = rows.map((r) => ({
    month: r.month,
    totalCents: r.totalCents,
    budgetLimitCents: null,
  }));
  return (
    <TwelveMonthBarChart
      rows={wrapped}
      currentMonth={currentMonth}
      projectedMonthEndCents={projectedMonthEndCents}
    />
  );
}
