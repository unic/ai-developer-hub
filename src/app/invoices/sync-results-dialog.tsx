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
    className: "border-success text-success",
  },
  newly_linked: {
    label: "Newly Linked",
    className: "border-border text-foreground",
  },
  corrected: {
    label: "Corrected",
    className: "border-warning text-warning",
  },
  unresolvable: {
    label: "Unresolvable",
    className: "border-warning text-warning",
  },
  error: {
    label: "Error",
    className: "border-destructive text-destructive",
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
  outcome,
  count,
}: {
  outcome: SyncOutcome;
  count: number;
}) {
  if (count === 0) return null;
  const config = outcomeBadgeConfig[outcome];
  return (
    <Badge variant="outline" className={config.className}>
      {config.label}: {count}
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
          <SummaryBadge outcome="verified" count={result.verified} />
          <SummaryBadge outcome="newly_linked" count={result.newlyLinked} />
          <SummaryBadge outcome="corrected" count={result.corrected} />
          <SummaryBadge outcome="unresolvable" count={result.unresolvable} />
          <SummaryBadge outcome="error" count={result.errors} />
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
