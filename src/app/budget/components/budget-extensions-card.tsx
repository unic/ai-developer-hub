"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatVariance } from "@/lib/utils";
import type { BudgetExtensionWithAllocations } from "@/types";
import { Plus, Trash2 } from "lucide-react";
import { CATEGORY_LABEL } from "./dialogs/extension-form";

interface Props {
  extensions: BudgetExtensionWithAllocations[];
  isAdmin: boolean;
  isArchived: boolean;
  onAdd: () => void;
  onDelete: (ext: BudgetExtensionWithAllocations) => void;
}

export function BudgetExtensionsCard({
  extensions,
  isAdmin,
  isArchived,
  onAdd,
  onDelete,
}: Props) {
  // For non-admin viewers with no extensions, hide the card entirely —
  // there's nothing meaningful to show and it'd just be empty chrome.
  if (extensions.length === 0 && !isAdmin) return null;

  const net = extensions.reduce((s, e) => s + e.amountCents, 0);
  const canEdit = isAdmin && !isArchived;

  return (
    <Card id="budget-extensions">
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold">Budget extensions</h3>
              <Badge variant="secondary" className="tabular-nums">
                {extensions.length}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1 max-w-prose">
              Mid-year changes to the annual ceiling. Each extension records why
              the budget moved and (optionally) which tool it funds.
            </p>
          </div>
          {extensions.length > 0 && (
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Net extended
              </p>
              <p
                className={`text-base font-semibold tabular-nums ${
                  net > 0
                    ? "text-primary"
                    : net < 0
                      ? "text-destructive"
                      : ""
                }`}
              >
                {formatVariance(net)}
              </p>
            </div>
          )}
        </div>

        {extensions.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No extensions yet for this budget.
            {canEdit && " Add one when the ceiling needs to move."}
          </div>
        ) : (
          <div className="border rounded-md overflow-hidden">
            {extensions.map((e, idx) => (
              <ExtensionRow
                key={e.id}
                extension={e}
                first={idx === 0}
                canEdit={canEdit}
                onDelete={() => onDelete(e)}
              />
            ))}
          </div>
        )}

        {canEdit && (
          <Button variant="secondary" onClick={onAdd} className="gap-1.5">
            <Plus className="size-4" />
            Add extension
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function ExtensionRow({
  extension,
  first,
  canEdit,
  onDelete,
}: {
  extension: BudgetExtensionWithAllocations;
  first: boolean;
  canEdit: boolean;
  onDelete: () => void;
}) {
  const isReduction = extension.amountCents < 0;
  const allocationSummary =
    extension.allocations.length === 0
      ? "Unallocated"
      : extension.allocations.length === 1
        ? "Allocated to 1 period"
        : `Distributed across ${extension.allocations.length} periods`;

  return (
    <div
      className={`p-4 grid grid-cols-[1fr_auto] gap-4 items-start ${
        first ? "" : "border-t"
      }`}
    >
      <div className="space-y-1.5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{extension.reason}</span>
          <Badge variant="secondary" className="text-[10px] uppercase">
            {CATEGORY_LABEL[extension.category]}
          </Badge>
          {extension.linkedToolName && (
            <Badge variant="outline">{extension.linkedToolName}</Badge>
          )}
        </div>
        {extension.description && (
          <p className="text-sm text-muted-foreground">
            {extension.description}
          </p>
        )}
        <div className="text-xs text-muted-foreground">
          Added{" "}
          <span className="text-foreground tabular-nums">
            {new Date(extension.createdAt).toISOString().slice(0, 10)}
          </span>{" "}
          by <span className="text-foreground">{extension.createdByName}</span>{" "}
          · Effective{" "}
          <span className="text-foreground tabular-nums">
            {extension.effectiveDate}
          </span>{" "}
          · {allocationSummary}
        </div>
      </div>
      <div className="text-right space-y-2 shrink-0">
        <p
          className={`text-lg font-semibold tabular-nums ${
            isReduction ? "text-destructive" : "text-primary"
          }`}
        >
          {formatVariance(extension.amountCents)}
        </p>
        {canEdit && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            title="Delete extension"
            aria-label={`Delete extension ${extension.reason}`}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
