"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ErrorPopover } from "./error-popover";
import type { SyncEventRow } from "@/actions/sync";
import type { SyncSourceType } from "@/lib/sync/framework";

const SOURCE_LABELS: Record<SyncSourceType, string> = {
  github_copilot_billing: "GitHub Copilot Billing",
  anthropic_api_usage: "Anthropic API Usage",
  anthropic_team_invoices: "Claude Team Invoices",
  github_members: "GitHub Members",
  invoice_period_matching: "Invoice-Period Matching",
  anthropic_api_costs: "Anthropic API Costs",
};

function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return <Badge variant="secondary">Unknown</Badge>;
  const variants: Record<
    string,
    "default" | "secondary" | "destructive" | "outline"
  > = {
    success: "default",
    partial: "outline",
    failed: "destructive",
    in_progress: "secondary",
  };
  return <Badge variant={variants[outcome] ?? "secondary"}>{outcome}</Badge>;
}

function formatDate(date: Date | string | null): string {
  if (!date) return "\u2014";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ManualJobsTableProps {
  events: SyncEventRow[];
}

export function ManualJobsTable({ events }: ManualJobsTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source</TableHead>
            <TableHead>Triggered By</TableHead>
            <TableHead>Run Time</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Created</TableHead>
            <TableHead className="text-right">Updated</TableHead>
            <TableHead className="text-right">Skipped</TableHead>
            <TableHead>Error</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={8}
                className="text-center text-muted-foreground"
              >
                No manual sync events yet.
              </TableCell>
            </TableRow>
          ) : (
            events.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="font-medium">
                  {SOURCE_LABELS[event.sourceType as SyncSourceType] ??
                    event.sourceType}
                </TableCell>
                <TableCell className="text-sm">
                  {event.triggeredBy?.name ?? "\u2014"}
                </TableCell>
                <TableCell className="text-sm">
                  {formatDate(event.startedAt)}
                </TableCell>
                <TableCell>
                  <OutcomeBadge outcome={event.outcome} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {event.createdCount}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {event.updatedCount}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {event.skippedCount}
                </TableCell>
                <TableCell>
                  <ErrorPopover errorMessage={event.errorMessage} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
