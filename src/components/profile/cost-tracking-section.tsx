"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MonthPicker } from "./month-picker";
import { formatCurrency } from "@/lib/utils";
import { getUserCostData } from "@/actions/anthropic-usage";
import { DollarSign, Info, AlertTriangle } from "lucide-react";
import type { CostData } from "@/types";

type CostTrackingSectionProps = {
  userId: number;
  initialData: CostData;
  availableMonths: string[];
};

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function CostTrackingSection({
  userId,
  initialData,
  availableMonths,
}: CostTrackingSectionProps) {
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());
  const [costData, setCostData] = useState<CostData>(initialData);
  const [isPending, startTransition] = useTransition();

  function handleMonthChange(month: string) {
    setSelectedMonth(month);
    startTransition(async () => {
      const data = await getUserCostData(userId, month);
      setCostData(data);
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
          <MonthPicker
            value={selectedMonth}
            onChange={handleMonthChange}
            months={availableMonths}
          />
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

        {/* Chart placeholder - will be added in Phase 5 (US3) */}
      </CardContent>
    </Card>
  );
}
