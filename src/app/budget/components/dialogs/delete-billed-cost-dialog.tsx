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
import { formatCurrency } from "@/lib/utils";
import type { BilledCost } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: BilledCost | null;
  onConfirm: () => void;
  saving: boolean;
}

export function DeleteBilledCostDialog({
  open,
  onOpenChange,
  entry,
  onConfirm,
  saving,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete billed cost?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently remove the billed cost entry
            {entry
              ? ` "${entry.description}" (${formatCurrency(entry.amountCents)})`
              : ""}
            . This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={saving}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {saving ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
