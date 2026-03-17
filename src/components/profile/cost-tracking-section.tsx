"use client";

import { useMemo, useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MonthPicker } from "./month-picker";
import { formatCurrency, getCurrentMonth } from "@/lib/utils";
import { getUserCostData } from "@/actions/anthropic-usage";
import { CostChart } from "@/components/cost-chart";
import { DollarSign, Info, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { CostData } from "@/types";

type CostTrackingSectionProps = {
  userId: number;
  initialData: CostData;
  availableMonths: string[];
  /** Optional header actions (e.g. admin sync button) rendered next to the month picker */
  headerActions?: React.ReactNode;
  /** Whether to show summary stats below the chart (default: true) */
  showSummaryStats?: boolean;
};

export function CostTrackingSection({
  userId,
  initialData,
  availableMonths,
  headerActions,
  showSummaryStats = true,
}: CostTrackingSectionProps) {
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());
  const [costData, setCostData] = useState<CostData>(initialData);
  const [isPending, startTransition] = useTransition();

  const topModelName = useMemo(() => {
    if (costData.dailyBreakdown.length === 0) return "—";
    const modelTotals = new Map<string, number>();
    for (const day of costData.dailyBreakdown) {
      for (const m of day.models) {
        modelTotals.set(m.model, (modelTotals.get(m.model) ?? 0) + m.costCents);
      }
    }
    const top = Array.from(modelTotals.entries()).sort((a, b) => b[1] - a[1])[0];
    if (!top) return "—";
    const match = top[0].match(/claude-(\w+)/);
    return match ? match[1].charAt(0).toUpperCase() + match[1].slice(1) : top[0];
  }, [costData.dailyBreakdown]);

  const peakDayLabel = useMemo(() => {
    if (costData.dailyBreakdown.length === 0) return "—";
    const peak = costData.dailyBreakdown.reduce((max, day) =>
      day.totalCents > max.totalCents ? day : max
    );
    const d = new Date(peak.date + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }, [costData.dailyBreakdown]);

  function handleMonthChange(month: string) {
    setSelectedMonth(month);
    startTransition(async () => {
      try {
        const data = await getUserCostData(userId, month);
        setCostData(data);
      } catch {
        toast.error("Failed to load cost data. Please try again.");
      }
    });
  }

  /** Allow parent (admin sync) to refresh cost data after a sync */
  function refreshData() {
    startTransition(async () => {
      try {
        const data = await getUserCostData(userId, selectedMonth);
        setCostData(data);
      } catch {
        toast.error("Failed to refresh cost data.");
      }
    });
  }

  // State 1: No API key configured
  if (!costData.available) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <DollarSign className="size-5" />
            Claude API Costs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <Info className="size-4" />
            <AlertDescription>
              {costData.error ||
                "No Claude API key configured. Contact your administrator to set up cost tracking."}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <DollarSign className="size-5" />
            Claude API Costs
          </CardTitle>
          <div className="flex items-center gap-2">
            <MonthPicker
              value={selectedMonth}
              onChange={handleMonthChange}
              months={availableMonths}
            />
            {headerActions}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Unresolved pricing warning */}
        {costData.hasUnresolvedPricing && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertDescription>
              Some usage data may have approximate costs due to unrecognized
              models.
            </AlertDescription>
          </Alert>
        )}

        {/* Monthly total */}
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Monthly Total</p>
          <p className={`text-3xl font-bold ${isPending ? "opacity-50" : ""}`}>
            {formatCurrency(costData.monthlyTotalCents)}
          </p>
          {costData.latestDataDate && (
            <p className="mt-1 text-xs text-muted-foreground">
              Data through {costData.latestDataDate}
            </p>
          )}
        </div>

        {/* State 2: No usage data */}
        {costData.monthlyTotalCents === 0 &&
          costData.dailyBreakdown.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No usage recorded for this month.
            </p>
          )}

        {/* Daily cost chart */}
        {costData.dailyBreakdown.length > 0 && (
          <div className={isPending ? "opacity-50" : ""}>
            <CostChart dailyBreakdown={costData.dailyBreakdown} />
          </div>
        )}

        {/* Summary stats */}
        {showSummaryStats && costData.dailyBreakdown.length > 0 && (
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="rounded-lg border p-3">
              <p className="text-sm text-muted-foreground">Active Days</p>
              <p className="text-lg font-semibold">
                {costData.dailyBreakdown.length}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-sm text-muted-foreground">Top Model</p>
              <p className="text-lg font-semibold truncate">
                {topModelName}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-sm text-muted-foreground">Peak Day</p>
              <p className="text-lg font-semibold">
                {peakDayLabel}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
