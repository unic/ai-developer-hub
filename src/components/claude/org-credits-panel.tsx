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
import { toast } from "sonner";
import type { OrgCreditsStatus } from "@/types";
import { formatCurrency } from "@/lib/utils";
import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

type OrgCreditsPanelProps = {
  orgConfig: { billingBudgetLimitCents: number | null } | null;
  currentMonthTotalCents: number;
  creditsStatus: OrgCreditsStatus;
};

export function OrgCreditsPanel({
  orgConfig,
  currentMonthTotalCents,
  creditsStatus,
}: OrgCreditsPanelProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(
    orgConfig?.billingBudgetLimitCents != null
      ? String(orgConfig.billingBudgetLimitCents / 100)
      : ""
  );
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const dollars = parseFloat(inputValue);
      const limitCents =
        isNaN(dollars) || inputValue.trim() === ""
          ? null
          : Math.round(dollars * 100);
      const result = await setOrgBillingBudget(limitCents);
      if (result.success) {
        toast.success("Billing budget updated.");
        setEditing(false);
      } else {
        toast.error(`Failed to update: ${result.error}`);
      }
    });
  }

  const limitCents = orgConfig?.billingBudgetLimitCents ?? null;
  const utilizationPct =
    limitCents != null && limitCents > 0
      ? Math.round((currentMonthTotalCents / limitCents) * 100)
      : null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly Billing Budget</CardTitle>
          <CardDescription>
            Org-wide monthly spend limit for Claude API usage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Current month spend</p>
              <p className="text-xl font-semibold tabular-nums">
                {formatCurrency(currentMonthTotalCents)}
              </p>
              {limitCents != null && (
                <p className="text-sm text-muted-foreground">
                  {utilizationPct ?? 0}% of {formatCurrency(limitCents)} budget
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {editing ? (
                <>
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-muted-foreground">$</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      className="w-32"
                      placeholder="No limit"
                      autoFocus
                    />
                  </div>
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
                </>
              ) : (
                <>
                  <span className="text-sm text-muted-foreground">
                    {limitCents != null ? formatCurrency(limitCents) : "No budget set"}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                    {limitCents != null ? "Edit budget" : "Set budget"}
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Credit Balance</CardTitle>
          <CardDescription>Remaining Anthropic credits for this org.</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <Info className="size-4" />
            <AlertDescription>
              Credit balance is not available via the Anthropic API.{" "}
              <a
                href="https://console.anthropic.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4"
              >
                View in Anthropic Console
              </a>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
