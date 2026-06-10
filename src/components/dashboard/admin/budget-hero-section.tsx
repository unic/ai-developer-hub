import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, ShieldCheck, AlertTriangle } from "lucide-react";
import { SpendProgressBar } from "@/components/shared/spend-progress-bar";
import { formatCurrency, formatVariance } from "@/lib/utils";
import type { ReportOverviewData } from "@/types";
import type { AdminSpendSeriesPoint } from "@/actions/dashboard";

interface BudgetHeroSectionProps {
  overview: ReportOverviewData;
  spendSeries: AdminSpendSeriesPoint[];
  budgetCeilingCents: number;
  /** Original (pre-extension) ceiling. Equal to budgetCeilingCents when not extended. */
  budgetOriginalCeilingCents: number;
  billedYtdCents: number;
}

export function BudgetHeroSection({
  overview,
  budgetCeilingCents,
  budgetOriginalCeilingCents,
  billedYtdCents,
}: BudgetHeroSectionProps) {
  if (budgetCeilingCents === 0 || !overview.budgetForecast) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <ShieldCheck className="size-6" aria-hidden />
            </div>
            <div>
              <h3 className="text-lg font-semibold">No active budget</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Create a fiscal year budget to track YTD spend, projections, and
                period variance.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-3">
                <Link href="/budget">Set up budget →</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const status = overview.budgetForecast.status;
  const atRisk = status === "at_risk";
  const Icon = atRisk ? AlertTriangle : ShieldCheck;
  const overage = overview.budgetForecast.projectedOverageCents;
  const projected = overview.budgetForecast.projectedAnnualTotalCents;
  const projectedNarrative = atRisk
    ? `Linear trend lands at ${formatCurrency(projected)} by year-end (${formatCurrency(overage)} over).`
    : `Linear trend lands at ${formatCurrency(projected)} by year-end — within the ${formatCurrency(budgetCeilingCents)} ceiling.`;

  const lastMonthNarrative =
    overview.lastCompletedMonthLabel && overview.lastCompletedMonthVariancePct !== null
      ? ` ${overview.lastCompletedMonthLabel} was ${Math.abs(overview.lastCompletedMonthVariancePct).toFixed(1)}% ${overview.lastCompletedMonthVariancePct > 0 ? "over" : "under"} plan.`
      : "";

  return (
    <Card className={atRisk ? "border-destructive/50" : undefined}>
      <CardContent className="space-y-5 pt-6">
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
                    ? `Projected ${formatCurrency(overage)} over`
                    : "Within budget"}
                </Badge>
                {budgetOriginalCeilingCents !== budgetCeilingCents && (
                  <Badge
                    variant="secondary"
                    className="tabular-nums"
                    title={`Original baseline ${formatCurrency(budgetOriginalCeilingCents)} · extended to ${formatCurrency(budgetCeilingCents)}`}
                  >
                    extended{" "}
                    {formatVariance(
                      budgetCeilingCents - budgetOriginalCeilingCents
                    )}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                YTD spend is{" "}
                <span className="font-medium text-foreground">
                  {formatCurrency(billedYtdCents)}
                </span>{" "}
                ({overview.utilizationPct.toFixed(1)}% of {formatCurrency(budgetCeilingCents)} ceiling).{" "}
                {projectedNarrative}
                {lastMonthNarrative}
              </p>
            </div>
          </div>
          <div className="lg:text-right">
            <Button asChild>
              <Link href="/reports/budget">
                Open Budget report
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
        </div>
        <SpendProgressBar
          actualYtd={billedYtdCents}
          ceiling={budgetCeilingCents}
          projectedAnnualTotal={projected}
        />
      </CardContent>
    </Card>
  );
}
