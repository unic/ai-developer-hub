"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorPopover } from "./error-popover";
import { OutcomeBadge } from "./outcome-badge";
import type { SyncEventRow } from "@/actions/sync";
import { SOURCE_LABELS } from "@/lib/sync/framework";
import { formatDateTime } from "@/lib/utils";

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
                  {SOURCE_LABELS[event.sourceType] ?? event.sourceType}
                </TableCell>
                <TableCell className="text-sm">
                  {event.triggeredBy?.name ?? "\u2014"}
                </TableCell>
                <TableCell className="text-sm">
                  {formatDateTime(event.completedAt ?? event.startedAt)}
                </TableCell>
                <TableCell>
                  <OutcomeBadge outcome={event.outcome} nullLabel="Unknown" />
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
