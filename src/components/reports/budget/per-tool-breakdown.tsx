"use client";

import { Fragment, useState } from "react";
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
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { BudgetPerToolRow } from "@/types";

interface PerToolBreakdownProps {
  rows: BudgetPerToolRow[];
}

export function PerToolBreakdown({ rows }: PerToolBreakdownProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const totalYtd = rows.reduce((s, r) => s + r.ytdSpentCents, 0);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Per-tool breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No tool-level spend recorded yet. Once licenses are assigned or API
            usage starts flowing in, tools will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Per-tool breakdown</CardTitle>
        <CardDescription>
          YTD spent vs current monthly · projected year-end · sorted by YTD spent
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Tool</TableHead>
                <TableHead className="text-right">YTD spent</TableHead>
                <TableHead className="text-right">Current monthly</TableHead>
                <TableHead className="text-right">Projected EOY</TableHead>
                <TableHead className="text-right">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const key = r.isAnthropicApi ? "anthropic-api" : `t-${r.toolId}`;
                const canExpand =
                  r.isAnthropicApi &&
                  r.workspaceBreakdown !== undefined &&
                  r.workspaceBreakdown.length > 0;
                const isExpanded = expanded.has(key);
                const sharePct =
                  totalYtd > 0 ? (r.ytdSpentCents / totalYtd) * 100 : 0;
                return (
                  <Fragment key={key}>
                    <TableRow>
                      <TableCell className="px-2">
                        {canExpand ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            onClick={() => toggle(key)}
                            aria-label={isExpanded ? "Collapse" : "Expand"}
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
                        {r.toolName}
                        {r.isAnthropicApi && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            running API
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(r.ytdSpentCents)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(r.currentMonthlyCents)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(r.projectedEoyCents)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {sharePct.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                    {isExpanded &&
                      r.workspaceBreakdown?.map((ws, i) => (
                        <TableRow
                          key={`${key}-ws-${ws.workspaceId ?? `idx-${i}`}`}
                          className="bg-muted/30"
                        >
                          <TableCell />
                          <TableCell className="pl-8 text-sm text-muted-foreground">
                            {ws.name}
                          </TableCell>
                          <TableCell />
                          <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                            {formatCurrency(ws.costCents)}
                          </TableCell>
                          <TableCell />
                          <TableCell />
                        </TableRow>
                      ))}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          License-based tools are derived from active assignments × tier cost.
          Anthropic API spend is the sum of live workspace usage. Invoiced
          billed_costs without a tool tag are included in the org Actual total
          but do not appear here.
        </p>
      </CardContent>
    </Card>
  );
}
