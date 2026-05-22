"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatCurrency, formatVariance } from "@/lib/utils";
import type { BudgetExtensionWithAllocations } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  extension: BudgetExtensionWithAllocations | null;
  onConfirm: () => void;
  saving: boolean;
}

export function DeleteExtensionDialog({
  open,
  onOpenChange,
  extension,
  onConfirm,
  saving,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete budget extension?</AlertDialogTitle>
          <AlertDialogDescription>
            {extension ? (
              <>
                This will reverse the{" "}
                <strong>{formatVariance(extension.amountCents)}</strong> change to
                the annual ceiling and undo the per-period allocations attached
                to{" "}
                <em className="not-italic font-medium">
                  &ldquo;{extension.reason}&rdquo;
                </em>
                . Affected periods will be reduced by{" "}
                {extension.allocations
                  .map((a) => formatCurrency(a.amountCents))
                  .join(", ") || "no per-period allocations"}
                . This action cannot be undone.
              </>
            ) : (
              "Loading…"
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={saving}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {saving ? "Deleting..." : "Delete extension"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
