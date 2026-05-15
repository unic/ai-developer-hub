"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ChevronRight } from "lucide-react";
import { setWorkspaceLimit } from "@/actions/anthropic-global";
import { Sparkline } from "@/components/ui/sparkline";
import { toast } from "sonner";
import type { WorkspaceListItem, WorkspaceSparkline } from "@/types";
import { cn, formatCurrency, projectMonthEnd } from "@/lib/utils";
import { getDaysInMonth, getDate } from "date-fns";

const HIDE_ZERO_STORAGE_KEY = "claude-hide-zero-workspaces";

function PaceLabel({ workspace }: { workspace: WorkspaceListItem }) {
  if (workspace.limitCents == null || workspace.limitCents <= 0) return null;
  const now = new Date();
  const daysInMonth = getDaysInMonth(now);
  const daysElapsed = Math.max(1, getDate(now));
  const projected = projectMonthEnd(
    workspace.currentMonthCents,
    daysElapsed,
    daysInMonth
  );
  const pacePct = Math.round((projected / workspace.limitCents) * 100);
  const overPace = pacePct >= 100;
  return (
    <p className="text-xs text-muted-foreground">
      {workspace.utilizationPct ?? 0}% ·{" "}
      <span className={overPace ? "text-destructive" : ""}>
        on pace {formatCurrency(projected)} ({pacePct}%)
      </span>
    </p>
  );
}

function SparklineDeltaLabel({
  months,
}: {
  months: { month: string; totalCents: number }[];
}) {
  if (months.length < 2) {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }
  const first = months[0].totalCents;
  const last = months[months.length - 1].totalCents;
  if (first === 0 && last === 0) {
    return <span className="text-[10px] text-muted-foreground">flat</span>;
  }
  if (first < 500) {
    return <span className="text-[10px] text-muted-foreground">new</span>;
  }
  const pct = Math.round(((last - first) / first) * 100);
  const big = pct >= 100;
  return (
    <span
      className={cn(
        "text-[10px]",
        big ? "text-amber-500 font-medium" : "text-muted-foreground"
      )}
    >
      {big ? "▲ " : ""}
      {pct >= 0 ? "+" : ""}
      {pct}% 6mo
    </span>
  );
}

type WorkspaceBudgetRowProps = {
  workspace: WorkspaceListItem;
  sparkline?: WorkspaceSparkline;
};

function WorkspaceBudgetRow({ workspace, sparkline }: WorkspaceBudgetRowProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(
    workspace.limitCents != null ? String(workspace.limitCents / 100) : ""
  );
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const dollars = parseFloat(inputValue);
      const limitCents =
        isNaN(dollars) || inputValue.trim() === ""
          ? null
          : Math.round(dollars * 100);
      try {
        const result = await setWorkspaceLimit(workspace.workspaceId, limitCents);
        if (result.success) {
          toast.success("Budget limit updated.");
          setEditing(false);
        } else {
          toast.error(`Failed to update limit: ${result.error}`);
        }
      } catch {
        toast.error("Failed to update limit: network error.");
      }
    });
  }

  const pct = workspace.utilizationPct;
  const isOver = pct != null && pct >= 100;
  const isWarn = pct != null && pct >= 80 && pct < 100;
  const barClass = isOver
    ? "bg-destructive"
    : isWarn
    ? "bg-amber-500"
    : "bg-primary";

  return (
    <div className="group flex items-center justify-between gap-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: workspace.displayColor ?? "#a1a1aa" }}
            aria-hidden
          />
          <span className="truncate font-medium">{workspace.name}</span>
          {workspace.isDefault && (
            <Badge variant="secondary" className="shrink-0 text-xs">
              Default
            </Badge>
          )}
          {isOver && (
            <Badge variant="destructive" className="shrink-0 text-xs">
              Over budget
            </Badge>
          )}
          {isWarn && (
            <Badge
              variant="outline"
              className="shrink-0 border-amber-500 text-amber-500 text-xs"
            >
              {pct}%
            </Badge>
          )}
          <Link
            href={`/claude/workspaces/${workspace.workspaceId ?? "default"}`}
            className="ml-auto text-muted-foreground transition-colors hover:text-foreground"
            title="Drill into workspace"
            aria-label={`Drill into ${workspace.name}`}
          >
            <ChevronRight className="size-4" />
          </Link>
        </div>
        <div className="mt-1 flex items-baseline gap-3">
          <span className="text-xl font-semibold tabular-nums">
            {formatCurrency(workspace.currentMonthCents)}
          </span>
          <span className="text-xs text-muted-foreground">
            of{" "}
            {workspace.limitCents != null
              ? formatCurrency(workspace.limitCents)
              : "no limit"}
          </span>
        </div>
        {workspace.limitCents != null && (
          <div className="mt-1.5 space-y-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full transition-all", barClass)}
                style={{ width: `${Math.min(workspace.utilizationPct ?? 0, 100)}%` }}
              />
            </div>
            <PaceLabel workspace={workspace} />
          </div>
        )}
      </div>

      <div className="hidden shrink-0 flex-col items-center gap-1 md:flex">
        <Sparkline
          data={(sparkline?.months ?? []).map((m) => m.totalCents / 100)}
          color={workspace.displayColor ?? "currentColor"}
          ariaLabel={`6-month trend for ${workspace.name}`}
          className="text-muted-foreground"
        />
        <SparklineDeltaLabel months={sparkline?.months ?? []} />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {editing ? (
          <>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground">$</span>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="w-28"
                placeholder="No limit"
                aria-label="Monthly limit in USD"
                autoFocus
              />
            </div>
            <Button size="sm" onClick={handleSave} disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            {workspace.limitCents != null ? "Edit limit" : "Set limit"}
          </Button>
        )}
      </div>
    </div>
  );
}

type WorkspaceBudgetListProps = {
  workspaces: WorkspaceListItem[];
  sparklines?: Record<string, WorkspaceSparkline>;
};

export function WorkspaceBudgetList({
  workspaces,
  sparklines,
}: WorkspaceBudgetListProps) {
  const [hideZero, setHideZero] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(HIDE_ZERO_STORAGE_KEY);
      if (stored != null) setHideZero(stored === "true");
    } catch {
      // ignore
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(HIDE_ZERO_STORAGE_KEY, String(hideZero));
    } catch {
      // ignore
    }
  }, [hideZero, hydrated]);

  const { visible, hidden } = useMemo(() => {
    if (!hideZero) return { visible: workspaces, hidden: [] as WorkspaceListItem[] };
    const v: WorkspaceListItem[] = [];
    const h: WorkspaceListItem[] = [];
    for (const w of workspaces) {
      if (w.currentMonthCents === 0 && w.limitCents == null) h.push(w);
      else v.push(w);
    }
    return { visible: v, hidden: h };
  }, [hideZero, workspaces]);

  if (workspaces.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No workspaces found.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">Workspace Budgets</CardTitle>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <span>Hide $0 + no limit</span>
          <Switch
            checked={hideZero}
            onCheckedChange={setHideZero}
            aria-label="Hide workspaces with $0 spend and no limit"
          />
        </label>
      </CardHeader>
      <CardContent>
        <div className="divide-y">
          {visible.map((ws) => (
            <WorkspaceBudgetRow
              key={ws.workspaceId ?? "__default__"}
              workspace={ws}
              sparkline={sparklines?.[ws.workspaceId ?? "__default__"]}
            />
          ))}
        </div>
        {hidden.length > 0 && (
          <div className="pt-3">
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => setShowHidden((s) => !s)}
            >
              {showHidden
                ? `Hide ${hidden.length} workspace${hidden.length === 1 ? "" : "s"} with no spend`
                : `Show ${hidden.length} hidden workspace${hidden.length === 1 ? "" : "s"}`}
            </button>
            {showHidden && (
              <div className="mt-2 divide-y">
                {hidden.map((ws) => (
                  <WorkspaceBudgetRow
                    key={ws.workspaceId ?? "__default__"}
                    workspace={ws}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
