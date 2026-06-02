"use client";

import { useState, useTransition } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setOrgBillingBudget } from "@/actions/anthropic-global";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
import { formatCurrency } from "@/lib/utils";
import type { TodayEstimate } from "@/lib/anthropic/estimate-today";
import { EstChip } from "@/components/claude/today-estimate";

type OrgBillingBudgetCardProps = {
  orgConfig: { billingBudgetLimitCents: number | null } | null;
  currentMonthTotalCents: number;
  projectedMonthEndCents: number;
  /** Spec 033 — estimate of today's spend (shown alongside actuals, not merged). */
  todayEstimate?: TodayEstimate | null;
};

export function OrgBillingBudgetCard({
  orgConfig,
  currentMonthTotalCents,
  projectedMonthEndCents,
  todayEstimate,
}: OrgBillingBudgetCardProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(
    orgConfig?.billingBudgetLimitCents != null
      ? String(orgConfig.billingBudgetLimitCents / 100)
      : ""
  );
  const [isPending, startTransition] = useTransition();
  const status = useInlineStatus();

  function handleSave() {
    startTransition(async () => {
      const dollars = parseFloat(inputValue);
      const limitCents =
        isNaN(dollars) || inputValue.trim() === ""
          ? null
          : Math.round(dollars * 100);
      const result = await setOrgBillingBudget(limitCents);
      if (result.success) {
        status.ok("Saved");
        setEditing(false);
      } else {
        status.error(result.error);
      }
    });
  }

  const limitCents = orgConfig?.billingBudgetLimitCents ?? null;
  const utilizationPct =
    limitCents != null && limitCents > 0
      ? Math.round((currentMonthTotalCents / limitCents) * 100)
      : null;
  const projectedPct =
    limitCents != null && limitCents > 0
      ? Math.round((projectedMonthEndCents / limitCents) * 100)
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Monthly Billing Budget</CardTitle>
        <CardDescription>
          Org-wide monthly spend limit for Claude API usage.{" "}
          <a
            href="https://console.anthropic.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            Credit balance is not exposed by the Anthropic API — view in console.
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 md:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Current spend
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatCurrency(currentMonthTotalCents)}
            </p>
            {todayEstimate && (
              <p className="mt-1 inline-flex flex-wrap items-center gap-1 text-xs text-primary">
                +{formatCurrency(todayEstimate.cents)} est. today
                <EstChip estimate={todayEstimate} />
              </p>
            )}
            {limitCents != null && (
              <p className="mt-1 text-xs text-muted-foreground">
                {utilizationPct ?? 0}% of {formatCurrency(limitCents)} budget
              </p>
            )}
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Projected month-end
            </p>
            <p
              className={`mt-1 text-xl font-semibold tabular-nums ${
                projectedPct != null && projectedPct >= 100
                  ? "text-destructive"
                  : projectedPct != null && projectedPct >= 80
                  ? "text-warning"
                  : ""
              }`}
            >
              {formatCurrency(projectedMonthEndCents)}
            </p>
            {limitCents != null && (
              <p
                className={`mt-1 text-xs ${
                  projectedPct != null && projectedPct >= 100
                    ? "text-destructive"
                    : "text-muted-foreground"
                }`}
              >
                {projectedPct ?? 0}% of {formatCurrency(limitCents)} budget
              </p>
            )}
          </div>

          <div className="flex flex-col items-start justify-start gap-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Budget
            </p>
            {editing ? (
              <>
                <div className="flex w-full items-center gap-1">
                  <span className="text-sm text-muted-foreground">$</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    className="w-32"
                    placeholder="No limit"
                    aria-label="Monthly billing budget limit in dollars"
                    autoFocus
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSave} disabled={isPending}>
                    {isPending ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(false)}
                    disabled={isPending}
                  >
                    Cancel
                  </Button>
                  <StatusText status={status.status} />
                </div>
              </>
            ) : (
              <div className="flex w-full items-center justify-between gap-2">
                <p className="text-xl font-semibold tabular-nums">
                  {limitCents != null ? formatCurrency(limitCents) : "—"}
                </p>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  {limitCents != null ? "Edit" : "Set"}
                </Button>
              </div>
            )}
          </div>
        </div>

        {limitCents != null && (
          <div className="mt-4 space-y-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all ${
                  (utilizationPct ?? 0) >= 100
                    ? "bg-destructive"
                    : (utilizationPct ?? 0) >= 80
                    ? "bg-warning"
                    : "bg-primary"
                }`}
                style={{ width: `${Math.min(utilizationPct ?? 0, 100)}%` }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
