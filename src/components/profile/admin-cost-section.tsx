"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { MonthPicker } from "./month-picker";
import { CostChart } from "@/components/cost-chart";
import { formatCurrency } from "@/lib/utils";
import {
  getUserCostData,
  syncAnthropicUsage,
} from "@/actions/anthropic-usage";
import { DollarSign, Info, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { CostData } from "@/types";

type AdminCostSectionProps = {
  userId: number;
  initialData: CostData;
  availableMonths: string[];
};

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function AdminCostSection({
  userId,
  initialData,
  availableMonths,
}: AdminCostSectionProps) {
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());
  const [costData, setCostData] = useState<CostData>(initialData);
  const [isPending, startTransition] = useTransition();
  const [isSyncing, setIsSyncing] = useState(false);

  function handleMonthChange(month: string) {
    setSelectedMonth(month);
    startTransition(async () => {
      const data = await getUserCostData(userId, month);
      setCostData(data);
    });
  }

  async function handleSync() {
    setIsSyncing(true);
    try {
      const result = await syncAnthropicUsage(userId);
      if (result.success) {
        toast.success(
          `Synced ${result.data.syncedDays} days of usage data.`
        );
        // Refresh current month data
        const data = await getUserCostData(userId, selectedMonth);
        setCostData(data);
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to sync usage data.");
    } finally {
      setIsSyncing(false);
    }
  }

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
              No API key configured for this user.
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
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={isSyncing}
            >
              <RefreshCw
                className={`mr-1 size-4 ${isSyncing ? "animate-spin" : ""}`}
              />
              Sync
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {costData.hasUnresolvedPricing && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertDescription>
              Some usage data may have approximate costs due to unrecognized
              models.
            </AlertDescription>
          </Alert>
        )}

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

        {costData.monthlyTotalCents === 0 &&
          costData.dailyBreakdown.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No usage recorded for this month.
            </p>
          )}

        {costData.dailyBreakdown.length > 0 && (
          <div className={isPending ? "opacity-50" : ""}>
            <CostChart dailyBreakdown={costData.dailyBreakdown} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
