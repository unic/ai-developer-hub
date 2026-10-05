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
import { SegmentedBar } from "@/components/ui/segmented-bar";
import { formatCurrency } from "@/lib/utils";
import type { TodayEstimate } from "@/lib/anthropic/estimate-today";
import { EstChip } from "@/components/claude/today-estimate";
import {
  creditBalanceProvenance,
  type CreditBalance,
} from "@/lib/credits";
import type { CreditPurchaseOverview } from "@/actions/credits";
import { CreditPurchases } from "@/components/claude/credit-purchases";
import { CreditOpeningBalance } from "@/components/claude/credit-opening-balance";

type OrgBillingBudgetCardProps = {
  orgConfig: { billingBudgetLimitCents: number | null } | null;
  currentMonthTotalCents: number;
  projectedMonthEndCents: number;
  /** Spec 033 — estimate of today's spend (shown alongside actuals, not merged). */
  todayEstimate?: TodayEstimate | null;
  /** Spec 045 — the Hub-derived prepaid credit balance, or an unavailable one. */
  creditBalance?: CreditBalance | null;
  /** Spec 045 — recorded top-ups and linkable invoices for that tool. */
  creditPurchases?: CreditPurchaseOverview | null;
};

export function OrgBillingBudgetCard({
  orgConfig,
  currentMonthTotalCents,
  projectedMonthEndCents,
  todayEstimate,
  creditBalance,
  creditPurchases,
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
          {creditBalance?.available ? (
            <>
              Prepaid credit balance:{" "}
              <span
                className={
                  creditBalance.balanceCents < 0
                    ? "font-medium text-destructive"
                    : "font-medium"
                }
              >
                {formatCurrency(creditBalance.balanceCents)}
              </span>{" "}
              — {creditBalanceProvenance(creditBalance)}
            </>
          ) : (
            <a
              href="https://console.anthropic.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              Credit balance is not exposed by the Anthropic API — record the
              opening balance from the console to track it here.
            </a>
          )}
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

        {creditBalance?.available && (
          <div className="mt-4 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              Credits: {formatCurrency(creditBalance.balanceCents)} remaining
            </span>{" "}
            = {formatCurrency(creditBalance.openingCents)} opening on{" "}
            {creditBalance.asOf} + {formatCurrency(creditBalance.purchasedCents)}{" "}
            purchased − {formatCurrency(creditBalance.consumedCents)} consumed.
            Purchases are cash paid for credits; consumption is what those
            credits were spent on. They are never added together.
            {creditBalance.balanceCents < 0 && (
              <span className="ml-1 text-destructive">
                A negative balance means a top-up has not been recorded, or the
                opening figure is out of date.
              </span>
            )}
          </div>
        )}

        {limitCents != null && (
          <div className="mt-4">
            <SegmentedBar
              value={Math.min(utilizationPct ?? 0, 100) / 100}
              tone={
                (utilizationPct ?? 0) >= 100
                  ? "over"
                  : (utilizationPct ?? 0) >= 80
                    ? "warn"
                    : "filled"
              }
              ariaLabel={`${utilizationPct ?? 0}% of monthly budget used`}
            />
          </div>
        )}

        {creditBalance && creditPurchases && (
          <>
            <CreditOpeningBalance
              toolId={creditBalance.toolId}
              openingCents={
                creditBalance.available ? creditBalance.openingCents : null
              }
              openingAt={creditBalance.asOf}
            />
            <CreditPurchases
              toolId={creditBalance.toolId}
              overview={creditPurchases}
              openingAt={creditBalance.asOf}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
