"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SyncNowButton } from "@/components/sync/sync-now-button";
import { BackfillDialog } from "@/components/sync/backfill-dialog";
import { ErrorPopover } from "@/components/error-popover";
import { OutcomeBadge } from "@/components/outcome-badge";
import { GitHubMemberSyncSheet } from "./github-member-sync-sheet";
import { SyncResultsDialog } from "@/app/invoices/sync-results-dialog";
import { syncInvoices } from "@/actions/invoice-sync";
import { triggerSync } from "@/actions/sync";
import { BACKFILL_SOURCES, SOURCE_LABELS, type SyncSourceType } from "@/lib/sync/framework";
import type { SyncSourceWithLastEvent } from "@/lib/sync/registry";
import type { SyncResult } from "@/types";
import { ChevronDown, Eye, RefreshCw, Users } from "lucide-react";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";

function formatRelativeTime(date: Date | string | null): string {
  if (!date) return "Never synced";
  const d = typeof date === "string" ? new Date(date) : date;
  return formatDistanceToNow(d, { addSuffix: true });
}

/** Convert a cron expression to a human-readable schedule label */
function formatCronSchedule(cron: string | null): string {
  if (!cron) return "Manual only";

  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every minute: * * * * *
  if (minute === "*" && hour === "*") return "Every minute";

  // Every N minutes: */N * * * *
  if (minute.startsWith("*/") && hour === "*") {
    const n = parseInt(minute.slice(2), 10);
    return n === 1 ? "Every minute" : `Every ${n} minutes`;
  }

  // Every hour at :MM: M * * * *
  if (hour === "*" && !minute.includes("/") && !minute.includes("*")) {
    const m = parseInt(minute, 10);
    return m === 0 ? "Every hour" : `Every hour at :${minute.padStart(2, "0")}`;
  }

  // Every N hours: 0 */N * * *
  if (minute === "0" && hour.startsWith("*/")) {
    const n = parseInt(hour.slice(2), 10);
    return n === 1 ? "Every hour" : `Every ${n} hours`;
  }

  // Daily at HH:MM: M H * * *
  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*" && !hour.includes("*") && !hour.includes("/")) {
    const h = parseInt(hour, 10);
    const m = parseInt(minute, 10);
    const suffix = h >= 12 ? "PM" : "AM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `Daily at ${h12}:${String(m).padStart(2, "0")} ${suffix} UTC`;
  }

  // Fallback: return the raw expression
  return cron;
}

interface ScheduledJobsTableProps {
  sources: SyncSourceWithLastEvent[];
}

export function ScheduledJobsTable({ sources }: ScheduledJobsTableProps) {
  const [dryRunResult, setDryRunResult] = useState<SyncResult | null>(null);
  const [dryRunDialogOpen, setDryRunDialogOpen] = useState(false);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [memberSyncOpen, setMemberSyncOpen] = useState(false);
  const router = useRouter();
  const status = useInlineStatus();

  async function handleDryRun() {
    setDryRunLoading(true);
    status.pending("Previewing");
    try {
      const result = await syncInvoices({ dryRun: true });
      if (result.success) {
        setDryRunResult(result.data);
        setDryRunDialogOpen(true);
        status.ok(`${result.data.totalProcessed} analyzed`);
      } else {
        status.error(result.error);
      }
    } catch {
      status.error("Dry run failed");
    } finally {
      setDryRunLoading(false);
    }
  }

  async function handleApplyFromDryRun() {
    setApplyLoading(true);
    status.pending("Starting sync");
    try {
      const result = await triggerSync("invoice_period_matching");
      if (result.success) {
        status.ok("Sync started");
        setDryRunDialogOpen(false);
        setDryRunResult(null);
        router.refresh();
      } else {
        status.error(result.error);
      }
    } catch {
      status.error("Apply failed");
    } finally {
      setApplyLoading(false);
    }
  }

  return (
    <>
      <div className="flex justify-end">
        <StatusText status={status.status} />
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Schedule</TableHead>
              <TableHead>Last Run</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Created</TableHead>
              <TableHead className="text-right">Updated</TableHead>
              <TableHead className="text-right">Skipped</TableHead>
              <TableHead>Error</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center text-muted-foreground"
                >
                  No sync sources configured.
                </TableCell>
              </TableRow>
            ) : (
              sources.map((source) => (
                <TableRow key={source.sourceType}>
                  <TableCell className="font-medium">
                    {SOURCE_LABELS[source.sourceType] ?? source.sourceType}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatCronSchedule(source.cronSchedule)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {source.lastEvent
                      ? source.lastEvent.outcome === "in_progress"
                        ? `Running (started ${formatRelativeTime(source.lastEvent.startedAt)})`
                        : formatRelativeTime(source.lastEvent.completedAt ?? source.lastEvent.startedAt)
                      : "Never synced"}
                  </TableCell>
                  <TableCell>
                    <OutcomeBadge
                      outcome={source.lastEvent?.outcome ?? null}
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {source.lastEvent?.createdCount ?? "\u2014"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {source.lastEvent?.updatedCount ?? "\u2014"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {source.lastEvent?.skippedCount ?? "\u2014"}
                  </TableCell>
                  <TableCell>
                    <ErrorPopover
                      errorMessage={source.lastEvent?.errorMessage ?? null}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {source.sourceType === "invoice_period_matching" ? (
                        <InvoiceSyncDropdown
                          disabled={!source.enabled}
                          onDryRun={handleDryRun}
                          dryRunLoading={dryRunLoading}
                        />
                      ) : source.sourceType === "github_members" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!source.enabled}
                          onClick={() => setMemberSyncOpen(true)}
                        >
                          <Users className="h-3 w-3 mr-1" />
                          Sync Now
                        </Button>
                      ) : source.sourceType === "anthropic_team_invoices" ? (
                        <span className="text-xs text-muted-foreground">
                          Via upload
                        </span>
                      ) : (
                        <SyncNowButton
                          sourceType={source.sourceType}
                          disabled={!source.enabled}
                        />
                      )}
                      {BACKFILL_SOURCES.includes(source.sourceType) && (
                        <BackfillDialog
                          sourceType={source.sourceType}
                          disabled={!source.enabled}
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <SyncResultsDialog
        open={dryRunDialogOpen}
        onOpenChange={setDryRunDialogOpen}
        result={dryRunResult}
        isDryRun={true}
        onConfirm={applyLoading ? undefined : handleApplyFromDryRun}
      />

      <GitHubMemberSyncSheet
        open={memberSyncOpen}
        onOpenChange={setMemberSyncOpen}
      />
    </>
  );
}

function InvoiceSyncDropdown({
  disabled,
  onDryRun,
  dryRunLoading,
}: {
  disabled: boolean;
  onDryRun: () => void;
  dryRunLoading: boolean;
}) {
  const [syncLoading, setSyncLoading] = useState(false);
  const router = useRouter();
  const status = useInlineStatus();

  async function handleSync() {
    setSyncLoading(true);
    status.pending("Starting sync");
    try {
      const result = await triggerSync("invoice_period_matching");
      if (result.success) {
        status.ok("Sync started");
        router.refresh();
      } else {
        status.error(result.error);
      }
    } catch {
      status.error("Trigger failed");
    } finally {
      setSyncLoading(false);
    }
  }

  const loading = syncLoading || dryRunLoading;

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={disabled || loading}>
            <RefreshCw
              className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`}
            />
            Sync
            <ChevronDown className="h-3 w-3 ml-1" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleSync} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Sync Now
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDryRun} disabled={loading}>
            <Eye className="h-4 w-4 mr-2" />
            Preview Changes (Dry Run)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <StatusText status={status.status} />
    </div>
  );
}
