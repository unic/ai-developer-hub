"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { SyncResult, SyncOutcome } from "@/types";

interface SyncResultsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: SyncResult | null;
  isDryRun: boolean;
  onConfirm?: () => void;
}

const outcomeBadgeConfig: Record<
  SyncOutcome,
  { label: string; className: string }
> = {
  verified: {
    label: "Verified",
    className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  },
  newly_linked: {
    label: "Newly Linked",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  },
  corrected: {
    label: "Corrected",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  },
  unresolvable: {
    label: "Unresolvable",
    className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  },
  error: {
    label: "Error",
    className:
      "bg-destructive text-white dark:bg-destructive/60",
  },
};

function OutcomeBadge({ outcome }: { outcome: SyncOutcome }) {
  const config = outcomeBadgeConfig[outcome];
  return (
    <Badge variant="outline" className={config.className}>
      {config.label}
    </Badge>
  );
}

function SummaryBadge({
  label,
  count,
  className,
}: {
  label: string;
  count: number;
  className: string;
}) {
  if (count === 0) return null;
  return (
    <Badge variant="outline" className={className}>
      {label}: {count}
    </Badge>
  );
}

export function SyncResultsDialog({
  open,
  onOpenChange,
  result,
  isDryRun,
  onConfirm,
}: SyncResultsDialogProps) {
  if (!result) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {isDryRun ? "Sync Preview (Dry Run)" : "Sync Results"}
          </DialogTitle>
          <DialogDescription>
            {isDryRun
              ? `Preview of changes for ${result.totalProcessed} invoice(s). No changes have been applied yet.`
              : `Processed ${result.totalProcessed} invoice(s).`}
          </DialogDescription>
        </DialogHeader>

        {/* Summary badges */}
        <div className="flex flex-wrap gap-2">
          <SummaryBadge
            label="Verified"
            count={result.verified}
            className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
          />
          <SummaryBadge
            label="Newly Linked"
            count={result.newlyLinked}
            className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
          />
          <SummaryBadge
            label="Corrected"
            count={result.corrected}
            className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
          />
          <SummaryBadge
            label="Unresolvable"
            count={result.unresolvable}
            className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
          />
          <SummaryBadge
            label="Errors"
            count={result.errors}
            className="bg-destructive text-white dark:bg-destructive/60"
          />
        </div>

        {/* Scrollable table */}
        <div className="overflow-auto max-h-[50vh] rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Previous Period</TableHead>
                <TableHead>New Period</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center text-muted-foreground"
                  >
                    No invoices processed.
                  </TableCell>
                </TableRow>
              ) : (
                result.items.map((item) => (
                  <TableRow key={item.invoiceId}>
                    <TableCell className="font-medium">
                      {item.invoiceNumber}
                    </TableCell>
                    <TableCell>{formatDate(item.invoiceDate)}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(item.amountCents)}
                    </TableCell>
                    <TableCell>{item.vendor ?? "—"}</TableCell>
                    <TableCell>
                      <OutcomeBadge outcome={item.outcome} />
                    </TableCell>
                    <TableCell>
                      {item.previousPeriodLabel ?? "—"}
                    </TableCell>
                    <TableCell>{item.newPeriodLabel ?? "—"}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground">
                      {item.reason ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {isDryRun && onConfirm && (
            <Button onClick={onConfirm}>Apply Changes</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
