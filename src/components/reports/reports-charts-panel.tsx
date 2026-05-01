"use client";

import { useState } from "react";
import { TrendsChart } from "./trends-chart";
import { UtilizationChart } from "./utilization-chart";
import { ForecastChart } from "./forecast-chart";
import { Sparkline } from "./sparkline";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import type {
  ReportOverviewData,
  PeriodSpendPoint,
  ToolUtilization,
  BudgetForecast,
  ForecastChartPoint,
  ToolSummaryItem,
  CircleReportItem,
} from "@/types";

interface ReportsChartsPanelProps {
  activeTab: "overview" | "trends" | "usage" | "forecast";
  overviewData: ReportOverviewData;
  trendsData: PeriodSpendPoint[];
  usageData: ToolUtilization[];
  forecastData: BudgetForecast | null;
  toolSummary: ToolSummaryItem[];
  circleReport: CircleReportItem[];
}

function buildForecastChartData(
  trendsData: PeriodSpendPoint[],
  forecastData: BudgetForecast
): ForecastChartPoint[] {
  let lastHistoricalIndex = trendsData.length - 1;
  for (let i = trendsData.length - 1; i >= 0; i--) {
    if (trendsData[i].billedCents > 0) {
      lastHistoricalIndex = i;
      break;
    }
  }

  const historical: ForecastChartPoint[] = trendsData.map((p, i) => ({
    month: p.month,
    historical: p.billedCents,
    projected:
      i === lastHistoricalIndex && forecastData.projections.length > 0
        ? p.billedCents
        : null,
  }));

  const projected: ForecastChartPoint[] = forecastData.projections.map((p) => ({
    month: p.month,
    historical: null,
    projected: p.projectedAmountCents,
  }));

  return [...historical, ...projected];
}

export function ReportsChartsPanel({
  activeTab,
  overviewData,
  trendsData,
  usageData,
  forecastData,
  toolSummary,
  circleReport,
}: ReportsChartsPanelProps) {
  const [showAllUsage, setShowAllUsage] = useState(false);

  const sparklineData = trendsData.slice(-6).map((p) => p.billedCents);

  if (activeTab === "overview") {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Active Users</p>
              <p className="text-2xl font-bold">
                {overviewData.totalActiveUsers}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Active Tools</p>
              <p className="text-2xl font-bold">
                {overviewData.totalActiveTools}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Active Licenses</p>
              <p className="text-2xl font-bold">
                {overviewData.totalActiveLicenses}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Expected Monthly
                  </p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(overviewData.expectedMonthlyCents)}
                  </p>
                </div>
                {sparklineData.length > 1 && (
                  <Sparkline data={sparklineData} />
                )}
              </div>
              <p
                className={`mt-1 text-xs ${
                  overviewData.spendTrend === "up"
                    ? "text-destructive"
                    : overviewData.spendTrend === "down"
                      ? "text-primary"
                      : "text-muted-foreground"
                }`}
              >
                {overviewData.spendTrend === "up"
                  ? `▲ ${overviewData.spendTrendPct.toFixed(1)}% vs last period`
                  : overviewData.spendTrend === "down"
                    ? `▼ ${Math.abs(overviewData.spendTrendPct).toFixed(1)}% vs last period`
                    : "Flat vs last period"}
              </p>
            </CardContent>
          </Card>
          {overviewData.budgetCeilingCents > 0 && (
            <>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Billed YTD</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(overviewData.billedYtdCents)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {overviewData.utilizationPct.toFixed(1)}% of budget
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">
                    Budget Remaining
                  </p>
                  <p
                    className={`text-2xl font-bold ${
                      overviewData.budgetRemainingCents < 0
                        ? "text-destructive"
                        : ""
                    }`}
                  >
                    {formatCurrency(overviewData.budgetRemainingCents)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    of {formatCurrency(overviewData.budgetCeilingCents)} total
                  </p>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Tool Adoption Summary</CardTitle>
            <CardDescription>
              Active license count and expected cost per tool
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tool</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Active Users</TableHead>
                    <TableHead>Expected Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...toolSummary]
                    .sort((a, b) => b.totalMonthlyCost - a.totalMonthlyCost)
                    .map((tool) => (
                      <TableRow key={tool.id}>
                        <TableCell className="font-medium">
                          {tool.name}
                        </TableCell>
                        <TableCell>{tool.vendor}</TableCell>
                        <TableCell>{tool.activeUsers}</TableCell>
                        <TableCell>
                          {formatCurrency(tool.totalMonthlyCost)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Circle Report</CardTitle>
            <CardDescription>
              License distribution and expected cost by circle
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Circle</TableHead>
                    <TableHead>Users</TableHead>
                    <TableHead>Licenses</TableHead>
                    <TableHead>Expected Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...circleReport]
                    .sort((a, b) => b.totalMonthlyCost - a.totalMonthlyCost)
                    .map((item) => (
                      <TableRow key={item.circle ?? "__no_circle__"}>
                        <TableCell className="font-medium">
                          {item.circle ?? "Unassigned"}
                        </TableCell>
                        <TableCell>{item.userCount}</TableCell>
                        <TableCell>{item.licenseCount}</TableCell>
                        <TableCell>
                          {formatCurrency(item.totalMonthlyCost)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (activeTab === "trends") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Spend Over Time</CardTitle>
          <CardDescription>
            Billed, expected, and planned spend by period
          </CardDescription>
        </CardHeader>
        <CardContent>
          {trendsData.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No spending data available yet.
            </p>
          ) : (
            <TrendsChart data={trendsData} />
          )}
        </CardContent>
      </Card>
    );
  }

  if (activeTab === "usage") {
    const displayedTools = showAllUsage ? usageData : usageData.slice(0, 10);

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>License Utilization by Tool</CardTitle>
            <CardDescription>
              Assigned seats vs. available capacity
            </CardDescription>
          </CardHeader>
          <CardContent>
            {usageData.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active tools found.
              </p>
            ) : (
              <UtilizationChart data={displayedTools} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Usage Details</CardTitle>
                <CardDescription>
                  {showAllUsage
                    ? `All ${usageData.length} tools`
                    : `Top ${Math.min(10, usageData.length)} tools by cost`}
                </CardDescription>
              </div>
              {usageData.length > 10 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAllUsage((v) => !v)}
                >
                  {showAllUsage ? "Show top 10" : "Show all"}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tool</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Assigned</TableHead>
                    <TableHead>Capacity</TableHead>
                    <TableHead>Utilization</TableHead>
                    <TableHead>Monthly Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedTools.map((tool) => (
                    <TableRow key={tool.toolId}>
                      <TableCell className="font-medium">
                        {tool.toolName}
                      </TableCell>
                      <TableCell>{tool.vendor}</TableCell>
                      <TableCell>{tool.assignedCount}</TableCell>
                      <TableCell>
                        {tool.maxLicenses !== null
                          ? tool.maxLicenses
                          : "Unlimited"}
                      </TableCell>
                      <TableCell>
                        {tool.maxLicenses !== null
                          ? `${tool.utilizationPct.toFixed(0)}%`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {formatCurrency(tool.expectedMonthlyCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Forecast tab
  if (!forecastData) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            No active budget found. Create a budget to enable forecasting.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (forecastData.insufficientData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Budget Forecast</CardTitle>
          <CardDescription>{forecastData.insufficientData}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The forecast requires at least 3 months of completed billing data.
          </p>
        </CardContent>
      </Card>
    );
  }

  const forecastChartData = buildForecastChartData(trendsData, forecastData);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Actual Spend to Date</p>
            <p className="text-2xl font-bold">
              {formatCurrency(forecastData.actualSpendToDateCents)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Projected Remaining</p>
            <p className="text-2xl font-bold">
              {formatCurrency(forecastData.projectedRemainingCents)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Projected Annual Total
                </p>
                <p className="text-2xl font-bold">
                  {formatCurrency(forecastData.projectedAnnualTotalCents)}
                </p>
              </div>
              <Badge
                variant={
                  forecastData.status === "on_track" ? "default" : "destructive"
                }
              >
                {forecastData.status === "on_track" ? "On Track" : "At Risk"}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Budget: {formatCurrency(forecastData.budgetCeilingCents)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Spend Forecast</CardTitle>
          <CardDescription>
            Historical spend with linear regression projection
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ForecastChart
            data={forecastChartData}
            monthlyBudgetCents={Math.round(forecastData.budgetCeilingCents / 12)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
