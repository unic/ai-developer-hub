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
import {
  StatusText,
  type InlineStatusState,
} from "@/components/ui/status-text";
import { formatCurrency, formatVariance } from "@/lib/utils";
import type { BudgetExtensionWithAllocations } from "@/types";

function summarizeReversal(extension: BudgetExtensionWithAllocations): string {
  if (extension.allocations.length === 0) return "no per-period allocations";
  // Render allocation magnitudes as positive amounts; the wording above the
  // list says whether they'll be added back or subtracted.
  return extension.allocations
    .map((a) => formatCurrency(Math.abs(a.amountCents)))
    .join(", ");
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  extension: BudgetExtensionWithAllocations | null;
  onConfirm: () => void;
  saving: boolean;
  /** Inline delete feedback — rendered in the footer (no toasts in the Nothing system). */
  status?: InlineStatusState;
}

export function DeleteExtensionDialog({
  open,
  onOpenChange,
  extension,
  onConfirm,
  saving,
  status,
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
                <strong>{formatVariance(extension.amountCents)}</strong> change
                to the annual ceiling and undo the per-period allocations
                attached to{" "}
                <em className="not-italic font-medium">
                  &ldquo;{extension.reason}&rdquo;
                </em>
                .{" "}
                {extension.allocations.length === 0
                  ? "No per-period allocations to revert."
                  : extension.amountCents > 0
                    ? `Affected periods will be reduced by ${summarizeReversal(extension)}.`
                    : `Affected periods will be increased by ${summarizeReversal(extension)}.`}{" "}
                This action cannot be undone.
              </>
            ) : (
              "Loading…"
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {status && <StatusText status={status} className="sm:mr-auto" />}
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
