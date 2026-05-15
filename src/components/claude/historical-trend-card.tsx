"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TwelveMonthBarChart } from "@/components/claude/twelve-month-bar-chart";
import { CumulativePacingChart } from "@/components/claude/cumulative-pacing-chart";
import { TopMoversChips } from "@/components/claude/top-movers-chips";
import { cn } from "@/lib/utils";
import type { PacingRow, TopMover, TwelveMonthRow } from "@/types";

type View = "monthly" | "pacing" | "growing";

type HistoricalTrendCardProps = {
  twelveMonth: TwelveMonthRow[];
  pacing: PacingRow[];
  movers: TopMover[];
};

export function HistoricalTrendCard({
  twelveMonth,
  pacing,
  movers,
}: HistoricalTrendCardProps) {
  const [view, setView] = useState<View>("monthly");

  return (
    <Card>
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Historical trend</CardTitle>
            <CardDescription>
              Last 12 months · monthly totals, pacing vs prior months, and the
              fastest-growing workspaces.
            </CardDescription>
          </div>
          <div className="inline-flex rounded-md border bg-muted p-0.5 text-xs">
            <SegBtn active={view === "monthly"} onClick={() => setView("monthly")}>
              Monthly totals
            </SegBtn>
            <SegBtn active={view === "pacing"} onClick={() => setView("pacing")}>
              Pacing
            </SegBtn>
            <SegBtn active={view === "growing"} onClick={() => setView("growing")}>
              Fastest growing
            </SegBtn>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Fastest growing (6mo):</span>
          <TopMoversChips movers={movers} />
        </div>
      </CardHeader>
      <CardContent>
        {view === "monthly" && <TwelveMonthBarChart rows={twelveMonth} />}
        {view === "pacing" && <CumulativePacingChart rows={pacing} />}
        {view === "growing" && (
          <div className="py-2">
            <p className="text-sm text-muted-foreground">
              {movers.length === 0
                ? "No workspaces have meaningful positive growth over the last 6 months."
                : `${movers.length} workspace${movers.length === 1 ? "" : "s"} have grown over the last 6 months (positive deltas only, ≥$5 prior period):`}
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              {movers.map((m) => (
                <li
                  key={m.workspaceId ?? "__default__"}
                  className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2"
                >
                  <span className="font-medium">{m.name}</span>
                  <span className="text-xs text-muted-foreground">
                    ${(m.priorCents / 100).toFixed(0)} → ${(m.currentCents / 100).toFixed(0)}
                  </span>
                  <span className="font-mono text-xs text-destructive">▲ +{m.deltaPct}%</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SegBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn(
        "h-7 rounded-sm px-3 text-xs",
        active && "bg-background shadow-sm"
      )}
    >
      {children}
    </Button>
  );
}
