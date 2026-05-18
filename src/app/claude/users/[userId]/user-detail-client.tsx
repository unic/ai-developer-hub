"use client";

import { useMemo, useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MonthPicker } from "@/components/profile/month-picker";
import { KpiStrip, type KpiTile } from "@/components/claude/kpi-strip";
import { WorkspaceDailyChart } from "@/components/claude/workspace-daily-chart";
import { WorkspaceModelBreakdown } from "@/components/claude/workspace-model-breakdown";
import { UserTwelveMonthBarChart } from "@/components/claude/user-twelve-month-bar-chart";
import { UserTopDates } from "@/components/claude/user-top-dates";
import { getUserDetail } from "@/actions/anthropic-users";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, TrendingDown, TrendingUp } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { UserDetail } from "@/types";

type Props = {
  userId: number;
  initial: UserDetail;
};

export function UserDetailClient({ userId, initial }: Props) {
  const [detail, setDetail] = useState<UserDetail>(initial);
  const [month, setMonth] = useState(initial.month);
  const [isPending, startTransition] = useTransition();

  function handleMonthChange(next: string) {
    setMonth(next);
    startTransition(async () => {
      const d = await getUserDetail(userId, next);
      if (d) setDetail(d);
    });
  }

  const monthLabel = useMemo(() => {
    const [y, m] = month.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", {
      month: "short",
      year: "numeric",
    });
  }, [month]);

  const tiles = useMemo<KpiTile[]>(() => {
    const momCaption =
      detail.momDeltaPct === null ? (
        <span className="text-muted-foreground">— no spend last month</span>
      ) : detail.momDeltaPct >= 0 ? (
        <span className="inline-flex items-center gap-1 text-emerald-500">
          <TrendingUp className="size-3" /> +{detail.momDeltaPct}% vs prior month
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-destructive">
          <TrendingDown className="size-3" /> {detail.momDeltaPct}% vs prior
          month
        </span>
      );

    const topModel = detail.modelBreakdown[0] ?? null;

    return [
      {
        label: `Total · ${monthLabel}`,
        value: formatCurrency(detail.currentMonthCents),
        caption:
          detail.priorMonthCents > 0
            ? `Prior month ${formatCurrency(detail.priorMonthCents)}`
            : "First month with data",
      },
      {
        label: "MoM Delta",
        value:
          detail.momDeltaCents >= 0
            ? `+${formatCurrency(detail.momDeltaCents)}`
            : `-${formatCurrency(Math.abs(detail.momDeltaCents))}`,
        caption: momCaption,
        tone:
          detail.momDeltaPct === null
            ? "default"
            : detail.momDeltaPct >= 0
            ? "success"
            : "danger",
      },
      {
        label: "Projected Month-End",
        value: formatCurrency(detail.projectedMonthEndCents),
        caption: "Linear projection by month-end",
      },
      {
        label: "Top Model",
        value: topModel ? (
          <span className="text-base">{topModel.modelName}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
        caption: topModel
          ? `${topModel.pct}% of this user's cost`
          : "No usage this month",
      },
    ];
  }, [detail, monthLabel]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <MonthPicker
            value={month}
            onChange={handleMonthChange}
            months={
              detail.availableMonths.length > 0 ? detail.availableMonths : [month]
            }
          />
          {isPending && (
            <span className="text-sm text-muted-foreground animate-pulse">
              Loading…
            </span>
          )}
        </div>
        {detail.hasUnresolvedPricing && (
          <Badge
            variant="outline"
            className="border-amber-500/40 bg-amber-500/5 text-amber-600 dark:text-amber-400"
          >
            <AlertTriangle className="mr-1 size-3" />
            Some pricing unresolved
          </Badge>
        )}
      </div>

      <KpiStrip tiles={tiles} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Daily cost · {monthLabel}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <WorkspaceDailyChart
            dailyTotals={detail.dailyTotals}
            color={detail.workspace.displayColor}
            limitCents={null}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Model breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <WorkspaceModelBreakdown rows={detail.modelBreakdown} scopeLabel="User" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top dates this month</CardTitle>
          </CardHeader>
          <CardContent>
            <UserTopDates rows={detail.topDates} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">12-month trend</CardTitle>
        </CardHeader>
        <CardContent>
          <UserTwelveMonthBarChart
            rows={detail.twelveMonth}
            currentMonth={month}
            projectedMonthEndCents={detail.projectedMonthEndCents}
          />
        </CardContent>
      </Card>
    </div>
  );
}
