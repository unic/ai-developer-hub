"use client";

import { useState, useTransition } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setWorkspaceLimit } from "@/actions/anthropic-global";
import { toast } from "sonner";
import type { WorkspaceListItem } from "@/types";

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

type WorkspaceBudgetRowProps = {
  workspace: WorkspaceListItem;
};

function WorkspaceBudgetRow({ workspace }: WorkspaceBudgetRowProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(
    workspace.limitCents != null ? String(workspace.limitCents / 100) : ""
  );
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const dollars = parseFloat(inputValue);
      const limitCents = isNaN(dollars) || inputValue.trim() === "" ? null : Math.round(dollars * 100);
      const result = await setWorkspaceLimit(workspace.workspaceId, limitCents);
      if (result.success) {
        toast.success("Budget limit updated.");
        setEditing(false);
      } else {
        toast.error(`Failed to update limit: ${result.error}`);
      }
    });
  }

  const utilizationColor =
    workspace.utilizationPct == null
      ? ""
      : workspace.utilizationPct >= 90
      ? "bg-destructive"
      : workspace.utilizationPct >= 75
      ? "bg-yellow-500"
      : "";

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{workspace.name}</span>
          {workspace.isDefault && (
            <Badge variant="secondary" className="shrink-0 text-xs">
              Default
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {formatCents(workspace.currentMonthCents)} this month
        </p>
        {workspace.limitCents != null && (
          <div className="mt-1 space-y-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all ${utilizationColor || "bg-primary"}`}
                style={{ width: `${Math.min(workspace.utilizationPct ?? 0, 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {workspace.utilizationPct ?? 0}% of {formatCents(workspace.limitCents)} limit
            </p>
          </div>
        )}
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
          <>
            <span className="text-sm text-muted-foreground">
              {workspace.limitCents != null ? formatCents(workspace.limitCents) : "No limit"}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              Set limit
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

type WorkspaceBudgetListProps = {
  workspaces: WorkspaceListItem[];
};

export function WorkspaceBudgetList({ workspaces }: WorkspaceBudgetListProps) {
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
      <CardHeader>
        <CardTitle className="text-base">Workspace Monthly Limits</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y">
          {workspaces.map((ws) => (
            <WorkspaceBudgetRow
              key={ws.workspaceId ?? "__default__"}
              workspace={ws}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
