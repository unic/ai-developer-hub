"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoadingState, InlineSpinner } from "@/components/ui/loading-state";
import { Button } from "@/components/ui/button";
import { AtAGlance } from "./at-a-glance";
import { PastMonthSpotlight } from "./past-month-spotlight";
import { PerToolBreakdown } from "./per-tool-breakdown";
import type { BudgetReportData } from "@/types";

const PlanVsActualChart = dynamic(
  () => import("./plan-vs-actual-chart").then((m) => m.PlanVsActualChart),
  { ssr: false, loading: () => <LoadingState label="LOADING" /> }
);
const ForecastCumulativeChart = dynamic(
  () =>
    import("./forecast-cumulative-chart").then(
      (m) => m.ForecastCumulativeChart
    ),
  { ssr: false, loading: () => <LoadingState label="LOADING" /> }
);

interface BudgetReportProps {
  data: BudgetReportData;
}

export function BudgetReport({ data }: BudgetReportProps) {
  if (data.kind === "empty") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No active budget</CardTitle>
          <CardDescription>
            Create a budget for the current fiscal year to enable this report.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/budget/new">Create a budget</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { budget, periodsWithActual, forecast, pastMonth, perTool } = data;
  const insufficientData = forecast.insufficientData;

  return (
    <div className="space-y-6">
      <AtAGlance budget={budget} periods={periodsWithActual} forecast={forecast} />

      {pastMonth && <PastMonthSpotlight pastMonth={pastMonth} />}

      <Card>
        <CardHeader>
          <CardTitle>Plan vs actual — FY {budget.fiscalYear}</CardTitle>
          <CardDescription>
            Planned bars next to billed + API · forecast for remaining months
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PlanVsActualChart periods={periodsWithActual} forecast={forecast} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Forecast — cumulative spend</CardTitle>
          <CardDescription>
            Actual cumulative · linear-regression forecast · ceiling reference
          </CardDescription>
        </CardHeader>
        <CardContent>
          {insufficientData ? (
            <p className="text-sm text-muted-foreground">
              {insufficientData} The forecast requires at least 3 months of
              completed spending.
            </p>
          ) : (
            <ForecastCumulativeChart
              periods={periodsWithActual}
              forecast={forecast}
            />
          )}
        </CardContent>
      </Card>

      <PerToolBreakdown rows={perTool} />
    </div>
  );
}
