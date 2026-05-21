"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { KpiWithMom } from "./overview/kpi-with-mom";
import { buildDelta, buildPctDelta } from "@/lib/format-delta";
import { BudgetHealthHero } from "./overview/budget-health-hero";
import { WhatChanged } from "./overview/what-changed";
import { formatCurrency, NO_CIRCLE_SENTINEL } from "@/lib/utils";
import { getStaticInsights } from "@/lib/reports/insights-static";
import type {
  ReportOverviewData,
  ToolSummaryItem,
  CircleReportItem,
  SparklinePoint,
} from "@/types";

interface OverviewPanelProps {
  overviewData: ReportOverviewData;
  toolSummary: ToolSummaryItem[];
  circleReport: CircleReportItem[];
  expectedMonthlySparkline: SparklinePoint[];
}

export function OverviewPanel({
  overviewData,
  toolSummary,
  circleReport,
  expectedMonthlySparkline,
}: OverviewPanelProps) {
  const previous = overviewData.previousMonth;

  const currentLicensesByTool = new Map<number, { name: string; count: number }>();
  for (const t of toolSummary) {
    if (t.activeUsers > 0) {
      currentLicensesByTool.set(t.id, { name: t.name, count: t.activeUsers });
    }
  }
  const previousLicensesByTool = new Map<number, { name: string; count: number }>();
  if (previous) {
    for (const t of toolSummary) {
      const count = previous.assignmentsByTool[t.id] ?? 0;
      if (count > 0) {
        previousLicensesByTool.set(t.id, { name: t.name, count });
      }
    }
  }

  const insights = getStaticInsights({
    current: {
      activeLicenses: overviewData.totalActiveLicenses,
      expectedMonthlyCents: overviewData.expectedMonthlyCents,
      licensesByTool: currentLicensesByTool,
    },
    previous: previous
      ? {
          activeLicenses: previous.activeLicenses,
          expectedMonthlyCents: previous.expectedMonthlyCents,
          licensesByTool: previousLicensesByTool,
        }
      : null,
    budget: overviewData.budgetForecast
      ? {
          status: overviewData.budgetForecast.status,
          projectedAnnualTotalCents:
            overviewData.budgetForecast.projectedAnnualTotalCents,
          budgetCeilingCents: overviewData.budgetCeilingCents,
        }
      : null,
    lastMonthVariancePct: overviewData.lastCompletedMonthVariancePct,
    lastMonthLabel: overviewData.lastCompletedMonthLabel,
  });

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiWithMom
          label="Active users"
          value={overviewData.totalActiveUsers.toLocaleString()}
        />
        <KpiWithMom
          label="Active tools"
          value={overviewData.totalActiveTools.toLocaleString()}
        />
        <KpiWithMom
          label="Active licenses"
          value={overviewData.totalActiveLicenses.toLocaleString()}
          delta={
            previous
              ? buildDelta(
                  overviewData.totalActiveLicenses - previous.activeLicenses
                )
              : undefined
          }
          comparison={
            previous
              ? `vs ${previous.activeLicenses.toLocaleString()} last month`
              : undefined
          }
        />
        <KpiWithMom
          label="Expected monthly"
          value={formatCurrency(overviewData.expectedMonthlyCents)}
          delta={
            previous && previous.expectedMonthlyCents > 0
              ? buildPctDelta(
                  overviewData.expectedMonthlyCents -
                    previous.expectedMonthlyCents,
                  previous.expectedMonthlyCents
                )
              : undefined
          }
          comparison={trendComparison(overviewData)}
          sparkline={expectedMonthlySparkline.map((p) => p.value)}
          note="Licenses only — API usage not included"
        />
      </div>

      {overviewData.budgetCeilingCents > 0 && overviewData.budgetForecast && (
        <BudgetHealthHero
          status={overviewData.budgetForecast.status}
          billedYtdCents={overviewData.billedYtdCents}
          budgetCeilingCents={overviewData.budgetCeilingCents}
          utilizationPct={overviewData.utilizationPct}
          projectedAnnualTotalCents={
            overviewData.budgetForecast.projectedAnnualTotalCents
          }
          projectedOverageCents={
            overviewData.budgetForecast.projectedOverageCents
          }
          lastCompletedMonthLabel={overviewData.lastCompletedMonthLabel}
          lastCompletedMonthVariancePct={
            overviewData.lastCompletedMonthVariancePct
          }
        />
      )}

      <WhatChanged insights={insights} />

      <Card>
        <CardHeader>
          <CardTitle>Tool adoption</CardTitle>
          <CardDescription>
            Active assignments and expected monthly cost · MoM license delta
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tool</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Active users</TableHead>
                  <TableHead className="text-right">MoM</TableHead>
                  <TableHead className="text-right">Expected monthly</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...toolSummary]
                  .sort((a, b) => b.totalMonthlyCost - a.totalMonthlyCost)
                  .map((tool) => {
                    const prior = previous?.assignmentsByTool[tool.id] ?? null;
                    const delta =
                      prior !== null ? tool.activeUsers - prior : null;
                    return (
                      <TableRow key={tool.id}>
                        <TableCell className="font-medium">
                          {tool.name}
                        </TableCell>
                        <TableCell>{tool.vendor}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {tool.activeUsers}
                        </TableCell>
                        <TableCell className="text-right">
                          {delta === null ? (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          ) : delta === 0 ? (
                            <Badge variant="secondary" className="font-mono text-[11px]">
                              ±0
                            </Badge>
                          ) : (
                            <Badge
                              variant={delta > 0 ? "destructive" : "default"}
                              className="font-mono text-[11px]"
                            >
                              {delta > 0 ? "+" : ""}
                              {delta}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(tool.totalMonthlyCost)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Spend by circle</CardTitle>
          <CardDescription>
            License distribution and expected cost across teams
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Circle</TableHead>
                  <TableHead className="text-right">Users</TableHead>
                  <TableHead className="text-right">Licenses</TableHead>
                  <TableHead className="text-right">Expected cost</TableHead>
                  <TableHead className="text-right">$ / user</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...circleReport]
                  .sort((a, b) => b.totalMonthlyCost - a.totalMonthlyCost)
                  .map((item) => {
                    const perUser =
                      item.userCount > 0
                        ? Math.round(item.totalMonthlyCost / item.userCount)
                        : 0;
                    return (
                      <TableRow key={item.circle ?? NO_CIRCLE_SENTINEL}>
                        <TableCell className="font-medium">
                          {item.circle ?? "Unassigned"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {item.userCount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {item.licenseCount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(item.totalMonthlyCost)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {formatCurrency(perUser)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function trendComparison(d: ReportOverviewData): string | undefined {
  if (d.spendTrend === "up") {
    return `▲ ${d.spendTrendPct.toFixed(1)}% in completed periods`;
  }
  if (d.spendTrend === "down") {
    return `▼ ${Math.abs(d.spendTrendPct).toFixed(1)}% in completed periods`;
  }
  return undefined;
}
