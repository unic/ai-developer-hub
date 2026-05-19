"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, ShieldCheck, AlertTriangle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface BudgetHealthHeroProps {
  status: "on_track" | "at_risk";
  billedYtdCents: number;
  budgetCeilingCents: number;
  utilizationPct: number;
  projectedAnnualTotalCents: number;
  projectedOverageCents: number;
  lastCompletedMonthLabel: string | null;
  lastCompletedMonthVariancePct: number | null;
}

export function BudgetHealthHero({
  status,
  billedYtdCents,
  budgetCeilingCents,
  utilizationPct,
  projectedAnnualTotalCents,
  projectedOverageCents,
  lastCompletedMonthLabel,
  lastCompletedMonthVariancePct,
}: BudgetHealthHeroProps) {
  const atRisk = status === "at_risk";
  const Icon = atRisk ? AlertTriangle : ShieldCheck;

  const projectedNarrative = atRisk
    ? `Linear trend lands at ${formatCurrency(projectedAnnualTotalCents)} by year-end (${formatCurrency(
        projectedOverageCents
      )} over).`
    : `Linear trend lands at ${formatCurrency(projectedAnnualTotalCents)} by year-end — within the ${formatCurrency(
        budgetCeilingCents
      )} ceiling.`;

  const lastMonthNarrative =
    lastCompletedMonthLabel && lastCompletedMonthVariancePct !== null
      ? ` ${lastCompletedMonthLabel} was ${Math.abs(lastCompletedMonthVariancePct).toFixed(
          1
        )}% ${lastCompletedMonthVariancePct > 0 ? "over" : "under"} plan.`
      : "";

  return (
    <Card className={atRisk ? "border-destructive/50" : undefined}>
      <CardContent className="pt-6">
        <div className="grid items-center gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2 flex items-start gap-4">
            <div
              className={`flex size-12 shrink-0 items-center justify-center rounded-full ${
                atRisk
                  ? "bg-destructive/10 text-destructive"
                  : "bg-primary/10 text-primary"
              }`}
              aria-hidden
            >
              <Icon className="size-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold">
                  Budget health · {atRisk ? "at risk" : "on track"}
                </h3>
                <Badge variant={atRisk ? "destructive" : "default"}>
                  {atRisk
                    ? `Projected ${formatCurrency(projectedOverageCents)} over`
                    : "Within budget"}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                YTD spend is{" "}
                <span className="font-medium text-foreground">
                  {formatCurrency(billedYtdCents)}
                </span>{" "}
                ({utilizationPct.toFixed(1)}% of {formatCurrency(budgetCeilingCents)} ceiling).{" "}
                {projectedNarrative}
                {lastMonthNarrative}
              </p>
            </div>
          </div>
          <div className="lg:text-right">
            <Button asChild>
              <Link href="/reports?tab=budget">
                Open Budget report
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
