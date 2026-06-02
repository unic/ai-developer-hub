"use client";

import { useMemo, useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MonthPicker } from "@/components/profile/month-picker";
import { KpiStrip, type KpiTile } from "@/components/claude/kpi-strip";
import { WorkspaceDailyChart } from "@/components/claude/workspace-daily-chart";
import { WorkspaceTopUsers } from "@/components/claude/workspace-top-users";
import { WorkspaceModelBreakdown } from "@/components/claude/workspace-model-breakdown";
import {
  getWorkspaceDetail,
  setWorkspaceLimit,
} from "@/actions/anthropic-global";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
import type { WorkspaceDetail } from "@/types";
import { AlertTriangle, TrendingDown, TrendingUp } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { getDaysInMonth, parseISO } from "date-fns";
import { totalTileCaption } from "@/components/claude/today-estimate";
import { InlineSpinner } from "@/components/ui/loading-state";

type Props = {
  workspaceIdParam: string;
  initial: WorkspaceDetail;
};

export function WorkspaceDetailClient({ workspaceIdParam, initial }: Props) {
  const [detail, setDetail] = useState<WorkspaceDetail>(initial);
  const [month, setMonth] = useState(initial.month);
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [limitInput, setLimitInput] = useState(
    detail.limitCents != null ? String(detail.limitCents / 100) : ""
  );
  const [savingLimit, savingTransition] = useTransition();
  const status = useInlineStatus();

  function handleMonthChange(next: string) {
    setMonth(next);
    startTransition(async () => {
      const d = await getWorkspaceDetail(workspaceIdParam, next);
      if (d) setDetail(d);
    });
  }

  function handleSaveLimit() {
    savingTransition(async () => {
      const dollars = parseFloat(limitInput);
      const cents =
        isNaN(dollars) || limitInput.trim() === ""
          ? null
          : Math.round(dollars * 100);
      const r = await setWorkspaceLimit(detail.workspace.id, cents);
      if (r.success) {
        status.ok("Limit updated");
        setEditing(false);
        const refreshed = await getWorkspaceDetail(workspaceIdParam, month);
        if (refreshed) setDetail(refreshed);
      } else {
        status.error(r.error);
      }
    });
  }

  const tiles = useMemo<KpiTile[]>(() => {
    const monthLabel = (() => {
      const [y, m] = month.split("-");
      return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", {
        month: "short",
        year: "numeric",
      });
    })();

    const momCaption =
      detail.momDeltaPct === null ? (
        <span className="text-muted-foreground">— no spend last month</span>
      ) : detail.momDeltaPct >= 0 ? (
        <span className="inline-flex items-center gap-1 text-foreground">
          <TrendingUp className="size-3" /> +{detail.momDeltaPct}% vs prior month
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <TrendingDown className="size-3" /> {detail.momDeltaPct}% vs prior month
        </span>
      );

    const isOver =
      detail.limitCents != null && detail.projectedMonthEndCents > detail.limitCents;
    const projectedPct =
      detail.limitCents != null && detail.limitCents > 0
        ? Math.round((detail.projectedMonthEndCents / detail.limitCents) * 100)
        : null;

    const utilizationTile: KpiTile =
      detail.limitCents == null
        ? {
            label: "Utilization",
            value: <span className="text-base text-muted-foreground">No limit set</span>,
            caption: (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => setEditing(true)}
              >
                Set limit
              </Button>
            ),
          }
        : {
            label: "Utilization",
            value: `${detail.utilizationPct ?? 0}%`,
            caption: `of ${formatCurrency(detail.limitCents)} monthly limit`,
            tone:
              (detail.utilizationPct ?? 0) >= 100
                ? "danger"
                : (detail.utilizationPct ?? 0) >= 80
                ? "warn"
                : "default",
          };

    return [
      {
        label: `Total · ${monthLabel}`,
        value: formatCurrency(detail.currentMonthCents),
        caption: totalTileCaption(detail.todayEstimate, detail.priorMonthCents),
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
        caption:
          detail.limitCents == null
            ? detail.todayEstimate
              ? "Run-rate incl. est. today"
              : "No limit set"
            : `${projectedPct ?? 0}% of ${formatCurrency(detail.limitCents)} limit${detail.todayEstimate ? " · incl. est. today" : ""}`,
        tone: isOver ? "danger" : projectedPct != null && projectedPct >= 80 ? "warn" : "default",
        ring: isOver,
        icon: isOver ? <AlertTriangle className="size-3 text-destructive" /> : undefined,
      },
      utilizationTile,
    ];
  }, [detail, month]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <MonthPicker
            value={month}
            onChange={handleMonthChange}
            months={detail.availableMonths.length > 0 ? detail.availableMonths : [month]}
          />
          {isPending && <InlineSpinner />}
        </div>
        {editing ? (
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">$</span>
              <Input
                type="number"
                min="0"
                step="0.01"
                className="w-28"
                value={limitInput}
                onChange={(e) => setLimitInput(e.target.value)}
                autoFocus
              />
              <Button size="sm" onClick={handleSaveLimit} disabled={savingLimit}>
                {savingLimit ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={savingLimit}>
                Cancel
              </Button>
              <StatusText status={status.status} />
            </div>
            {detail.workspace.isDefault && (
              <p className="text-xs text-muted-foreground">
                Applies to all API usage not assigned to a named workspace.
              </p>
            )}
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            {detail.limitCents != null ? "Edit limit" : "Set limit"}
          </Button>
        )}
      </div>

      <KpiStrip tiles={tiles} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily spend</CardTitle>
        </CardHeader>
        <CardContent>
          <WorkspaceDailyChart
            dailyTotals={detail.dailyTotals}
            limitCents={detail.limitCents}
            daysInMonth={getDaysInMonth(parseISO(`${month}-01`))}
            estimatedTodayCents={detail.todayEstimate?.cents ?? null}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top users this month</CardTitle>
          </CardHeader>
          <CardContent>
            <WorkspaceTopUsers users={detail.topUsers} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Model breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <WorkspaceModelBreakdown rows={detail.modelBreakdown} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
