"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatVariance,
  varianceClassName,
} from "@/lib/utils";
import type { BilledCost, BudgetWithCosts } from "@/types";
import type { RunningCostsResult } from "@/lib/budget-utils";
import { classifyPeriod } from "@/lib/reports/period-helpers";

interface Props {
  budget: BudgetWithCosts;
  runningCosts: Record<number, RunningCostsResult>;
  allocations: Record<number, number>;
  onAllocationChange: (periodId: number, cents: number) => void;
  isAdmin: boolean;
  isArchived: boolean;
  saving: boolean;
  onSaveAllocations: () => void;
  onAddBilledCost: (periodId: number) => void;
  onEditBilledCost: (entry: BilledCost) => void;
  onDeleteBilledCost: (entry: BilledCost) => void;
}

function rowClassFor(args: {
  isCurrent: boolean;
  isOverExpected: boolean;
  isUnderExpected: boolean;
  isFuture: boolean;
}): string {
  if (args.isCurrent) return "border-l-4 border-primary";
  if (args.isOverExpected) return "border-l-4 border-destructive";
  if (args.isUnderExpected) return "border-l-4 border-success";
  if (args.isFuture) return "text-muted-foreground";
  return "";
}

export function PeriodAllocationsTable({
  budget,
  runningCosts,
  allocations,
  onAllocationChange,
  isAdmin,
  isArchived,
  saving,
  onSaveAllocations,
  onAddBilledCost,
  onEditBilledCost,
  onDeleteBilledCost,
}: Props) {
  const periods = budget.periods;
  const [expandedPeriods, setExpandedPeriods] = useState<Set<number>>(new Set());
  const today = new Date();

  function togglePeriod(periodId: number) {
    setExpandedPeriods((prev) => {
      const next = new Set(prev);
      if (next.has(periodId)) next.delete(periodId);
      else next.add(periodId);
      return next;
    });
  }

  const canEdit = isAdmin && !isArchived;

  // Footer scopes expected/actual/variance to the closed window — the same
  // window the hero's "Variance through {lastClosed}" tile uses. A partial
  // current period vs full-month expected is a misleading variance; future
  // periods contribute zero on both sides and just dilute the signal.
  // Allocated stays as the sum of every period's planned amount (it answers
  // "what have I committed to spend over the year", which is meaningful
  // independent of phase).
  let allocatedTotal = 0;
  let closedExpected = 0;
  let closedActual = 0;
  let lastClosedLabel: string | null = null;
  let lastClosedEndDate = "";
  for (const p of periods) {
    allocatedTotal += allocations[p.id] ?? 0;
    if (classifyPeriod(p, today) !== "past") continue;
    closedExpected += p.expectedSpendCents;
    closedActual +=
      p.billedTotalCents + (runningCosts[p.id]?.runningCostCents ?? 0);
    if (p.endDate > lastClosedEndDate) {
      lastClosedEndDate = p.endDate;
      lastClosedLabel = p.periodLabel;
    }
  }
  const closedVariance = closedActual - closedExpected;

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Period</TableHead>
              <TableHead>Planned</TableHead>
              <TableHead>Expected</TableHead>
              <TableHead>Actual</TableHead>
              <TableHead>Variance (Actual − Expected)</TableHead>
              <TableHead>% Diff</TableHead>
              {canEdit && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {periods.map((period) => {
              const planned = allocations[period.id] ?? 0;
              const expected = period.expectedSpendCents;
              const billed = period.billedTotalCents;
              const periodRunning = runningCosts[period.id];
              const runningCents = periodRunning?.runningCostCents ?? 0;
              const actualCents = billed + runningCents;
              const variance = actualCents - expected;
              const pctDiff =
                expected > 0
                  ? Math.round(((actualCents - expected) / expected) * 100)
                  : 0;
              const phase = classifyPeriod(period, today);
              const isCurrent = phase === "current";
              const isFuture = phase === "future";
              const isClosed = phase === "past";
              const isOverExpected = isClosed && variance > expected * 0.05;
              const isUnderExpected = isClosed && variance < -expected * 0.05;
              const isExpanded = expandedPeriods.has(period.id);
              const hasEntries =
                (period.billedEntries && period.billedEntries.length > 0) ||
                !!periodRunning;
              const rowClass = rowClassFor({
                isCurrent,
                isOverExpected,
                isUnderExpected,
                isFuture,
              });

              return (
                <Fragment key={period.id}>
                  <TableRow id={`period-${period.id}`} className={rowClass}>
                    <TableCell className="w-8 px-2">
                      {hasEntries ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          onClick={() => togglePeriod(period.id)}
                          aria-label={
                            isExpanded ? "Collapse period" : "Expand period"
                          }
                        >
                          {isExpanded ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </Button>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-2">
                        {period.periodLabel}
                        {isCurrent && (
                          <Badge
                            variant="default"
                            className="h-5 px-1.5 text-[10px]"
                          >
                            Current
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      {canEdit ? (
                        <Input
                          type="number"
                          step="0.01"
                          className="w-28"
                          value={(planned / 100).toFixed(2)}
                          onChange={(e) =>
                            onAllocationChange(
                              period.id,
                              Math.round(Number(e.target.value) * 100)
                            )
                          }
                          aria-label={`Planned allocation for ${period.periodLabel}`}
                        />
                      ) : (
                        formatCurrency(planned)
                      )}
                    </TableCell>
                    <TableCell>{formatCurrency(expected)}</TableCell>
                    <TableCell
                      className={
                        runningCents > 0 ? "text-foreground" : ""
                      }
                    >
                      {formatCurrency(actualCents)}
                      {runningCents > 0 && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          (API)
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className={
                        isClosed ? varianceClassName(variance) : "text-muted-foreground"
                      }
                    >
                      {isClosed ? formatVariance(variance) : "—"}
                    </TableCell>
                    <TableCell>
                      {isOverExpected ? (
                        <Badge variant="destructive">{pctDiff}%</Badge>
                      ) : isUnderExpected ? (
                        <Badge variant="secondary">{pctDiff}%</Badge>
                      ) : isClosed ? (
                        <span>{pctDiff}%</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {canEdit && (
                      <TableCell className="px-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => onAddBilledCost(period.id)}
                          title="Add billed cost"
                          aria-label={`Add billed cost to ${period.periodLabel}`}
                        >
                          <Plus className="size-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                  {isExpanded && (
                    <>
                      {period.billedEntries?.map((entry) => (
                        <TableRow
                          key={`billed-${entry.id}`}
                          className="bg-muted/30"
                        >
                          <TableCell />
                          <TableCell
                            colSpan={2}
                            className="text-sm text-muted-foreground pl-8"
                          >
                            <span className="font-medium">
                              {entry.description}
                            </span>
                            {entry.vendorReference && (
                              <span className="ml-2 text-xs">
                                (Ref: {entry.vendorReference})
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDate(entry.invoiceDate)}
                          </TableCell>
                          <TableCell className="text-sm">
                            {formatCurrency(entry.amountCents)}
                          </TableCell>
                          <TableCell />
                          <TableCell />
                          {canEdit && (
                            <TableCell className="px-2">
                              <div className="flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-6"
                                  onClick={() => onEditBilledCost(entry)}
                                  title="Edit"
                                  aria-label={`Edit ${entry.description}`}
                                >
                                  <Pencil className="size-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-6 text-destructive"
                                  onClick={() => onDeleteBilledCost(entry)}
                                  title="Delete"
                                  aria-label={`Delete ${entry.description}`}
                                >
                                  <Trash2 className="size-3" />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                      {periodRunning && (
                        <TableRow
                          key={`running-${period.id}`}
                          className="bg-muted/30"
                        >
                          <TableCell />
                          <TableCell colSpan={2} className="text-sm pl-8">
                            <span className="inline-flex items-center gap-2 font-medium text-foreground">
                              Anthropic API
                              <Badge
                                variant="outline"
                                className="h-5 px-1.5 text-[10px] text-muted-foreground"
                              >
                                live
                              </Badge>
                            </span>
                            {periodRunning.lastUpdatedAt && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                Updated{" "}
                                {formatDateTime(periodRunning.lastUpdatedAt)}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-foreground">
                            {formatCurrency(periodRunning.runningCostCents)}
                          </TableCell>
                          <TableCell />
                          <TableCell />
                          {canEdit && <TableCell />}
                        </TableRow>
                      )}
                      {periodRunning &&
                        periodRunning.workspaceBreakdown?.map((ws, index) => (
                          <TableRow
                            key={
                              ws.workspaceId != null
                                ? `ws-${period.id}-${ws.workspaceId}`
                                : `ws-${period.id}-idx-${index}`
                            }
                            className="bg-muted/20"
                          >
                            <TableCell />
                            <TableCell
                              colSpan={2}
                              className="text-xs text-muted-foreground pl-12"
                            >
                              {ws.name}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {formatCurrency(ws.costCents)}
                            </TableCell>
                            <TableCell />
                            <TableCell />
                            {canEdit && <TableCell />}
                          </TableRow>
                        ))}
                    </>
                  )}
                </Fragment>
              );
            })}
            <TableRow className="font-bold">
              <TableCell />
              <TableCell>
                {lastClosedLabel
                  ? `Total through ${lastClosedLabel}`
                  : "Total"}
              </TableCell>
              <TableCell>{formatCurrency(allocatedTotal)}</TableCell>
              <TableCell>
                {lastClosedLabel ? (
                  formatCurrency(closedExpected)
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                {lastClosedLabel ? (
                  formatCurrency(closedActual)
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell
                className={
                  lastClosedLabel
                    ? varianceClassName(closedVariance)
                    : "text-muted-foreground"
                }
              >
                {lastClosedLabel ? formatVariance(closedVariance) : "—"}
              </TableCell>
              <TableCell />
              {canEdit && <TableCell />}
            </TableRow>
          </TableBody>
        </Table>
      </div>
      {canEdit && (
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={onSaveAllocations} disabled={saving}>
            {saving ? "Saving..." : "Save Allocations"}
          </Button>
          {allocatedTotal > budget.totalAmountCents && (
            <p className="text-sm text-destructive">
              Allocations exceed budget by{" "}
              {formatCurrency(allocatedTotal - budget.totalAmountCents)}
            </p>
          )}
        </div>
      )}
    </>
  );
}
