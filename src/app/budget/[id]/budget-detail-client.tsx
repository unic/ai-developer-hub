"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateBudgetAllocations } from "@/actions/budget";
import { formatCurrency } from "@/lib/utils";
import type { AnnualBudget, BudgetPeriod } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
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

type PeriodWithActual = BudgetPeriod & { actualSpendCents: number };

interface ToolSpend {
  toolId: number;
  toolName: string;
  totalCents: number;
  assignmentCount: number;
}

interface Props {
  budget: AnnualBudget;
  periods: PeriodWithActual[];
  toolBreakdown: ToolSpend[];
  isAdmin: boolean;
}

export function BudgetDetailClient({
  budget,
  periods,
  toolBreakdown,
  isAdmin,
}: Props) {
  const router = useRouter();
  const [allocations, setAllocations] = useState<Record<number, number>>(
    Object.fromEntries(periods.map((p) => [p.id, p.plannedAmountCents]))
  );
  const [saving, setSaving] = useState(false);

  const totalAllocated = Object.values(allocations).reduce((s, v) => s + v, 0);
  const totalActual = periods.reduce((s, p) => s + p.actualSpendCents, 0);
  const ytdVariance = totalAllocated - totalActual;

  async function handleSave() {
    setSaving(true);
    const result = await updateBudgetAllocations({
      budgetId: budget.id,
      allocations: Object.entries(allocations).map(([periodId, amount]) => ({
        periodId: Number(periodId),
        plannedAmountCents: amount,
      })),
    });
    setSaving(false);

    if (result.success) {
      toast.success("Allocations saved");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">FY {budget.fiscalYear} Budget</h1>
          <p className="text-muted-foreground capitalize">
            {budget.periodType} allocation
          </p>
        </div>
        <Badge variant={budget.status === "active" ? "default" : "secondary"}>
          {budget.status}
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Budget</p>
            <p className="text-2xl font-bold">
              {formatCurrency(budget.totalAmountCents)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Allocated</p>
            <p className="text-2xl font-bold">
              {formatCurrency(totalAllocated)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Actual Spend</p>
            <p className="text-2xl font-bold">
              {formatCurrency(totalActual)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Variance</p>
            <p
              className={`text-2xl font-bold ${ytdVariance < 0 ? "text-destructive" : ""}`}
            >
              {formatCurrency(ytdVariance)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Period Allocations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Planned</TableHead>
                  <TableHead>Actual</TableHead>
                  <TableHead>Variance</TableHead>
                  <TableHead>% Diff</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((period) => {
                  const planned = allocations[period.id] ?? 0;
                  const actual = period.actualSpendCents;
                  const variance = planned - actual;
                  const pctDiff =
                    planned > 0
                      ? Math.round(((actual - planned) / planned) * 100)
                      : 0;
                  const isOverrun = actual > planned * 1.1; // FR-013: 10% threshold

                  return (
                    <TableRow
                      key={period.id}
                      className={isOverrun ? "bg-destructive/10" : ""}
                    >
                      <TableCell className="font-medium">
                        {period.periodLabel}
                      </TableCell>
                      <TableCell>
                        {isAdmin && budget.status === "active" ? (
                          <Input
                            type="number"
                            step="0.01"
                            className="w-28"
                            value={(
                              (allocations[period.id] ?? 0) / 100
                            ).toFixed(2)}
                            onChange={(e) => {
                              const cents = Math.round(
                                Number(e.target.value) * 100
                              );
                              setAllocations((prev) => ({
                                ...prev,
                                [period.id]: cents,
                              }));
                            }}
                          />
                        ) : (
                          formatCurrency(planned)
                        )}
                      </TableCell>
                      <TableCell>{formatCurrency(actual)}</TableCell>
                      <TableCell
                        className={variance < 0 ? "text-destructive" : ""}
                      >
                        {formatCurrency(variance)}
                      </TableCell>
                      <TableCell>
                        {isOverrun ? (
                          <Badge variant="destructive">{pctDiff}%</Badge>
                        ) : (
                          <span>{pctDiff}%</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="font-bold">
                  <TableCell>YTD Total</TableCell>
                  <TableCell>{formatCurrency(totalAllocated)}</TableCell>
                  <TableCell>{formatCurrency(totalActual)}</TableCell>
                  <TableCell
                    className={ytdVariance < 0 ? "text-destructive" : ""}
                  >
                    {formatCurrency(ytdVariance)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>
          {isAdmin && budget.status === "active" && (
            <div className="mt-4 flex items-center gap-3">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save Allocations"}
              </Button>
              {totalAllocated > budget.totalAmountCents && (
                <p className="text-sm text-destructive">
                  Allocations exceed budget by{" "}
                  {formatCurrency(totalAllocated - budget.totalAmountCents)}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {toolBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Per-Tool Spending Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {toolBreakdown.map((tool) => {
                const pct =
                  totalActual > 0
                    ? Math.round((tool.totalCents / totalActual) * 100)
                    : 0;
                return (
                  <div
                    key={tool.toolId}
                    className="flex items-center justify-between"
                  >
                    <div>
                      <p className="font-medium">{tool.toolName}</p>
                      <p className="text-sm text-muted-foreground">
                        {tool.assignmentCount} license(s)
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">
                        {formatCurrency(tool.totalCents)}
                      </p>
                      <p className="text-sm text-muted-foreground">{pct}%</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
