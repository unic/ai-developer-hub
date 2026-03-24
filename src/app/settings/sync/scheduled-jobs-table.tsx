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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SyncNowButton } from "@/components/sync/sync-now-button";
import { BackfillDialog } from "@/components/sync/backfill-dialog";
import { ErrorPopover } from "./error-popover";
import { GitHubMemberSyncSheet } from "./github-member-sync-sheet";
import { SyncResultsDialog } from "@/app/invoices/sync-results-dialog";
import { syncInvoices } from "@/actions/invoice-sync";
import { triggerSync } from "@/actions/sync";
import { BACKFILL_SOURCES, type SyncSourceType } from "@/lib/sync/framework";
import type { SyncSourceWithLastEvent } from "@/lib/sync/registry";
import type { SyncResult } from "@/types";
import { ChevronDown, Eye, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";

const SOURCE_LABELS: Record<SyncSourceType, string> = {
  github_copilot_billing: "GitHub Copilot Billing",
  anthropic_api_usage: "Anthropic API Usage",
  anthropic_team_invoices: "Claude Team Invoices",
  github_members: "GitHub Members",
  invoice_period_matching: "Invoice-Period Matching",
  anthropic_api_costs: "Anthropic API Costs",
};

function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return <Badge variant="secondary">Never synced</Badge>;
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

function formatRelativeTime(date: Date | string | null): string {
  if (!date) return "Never synced";
  const d = typeof date === "string" ? new Date(date) : date;
  return formatDistanceToNow(d, { addSuffix: true });
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

  async function handleDryRun() {
    setDryRunLoading(true);
    toast.info("Running invoice sync preview...");
    try {
      const result = await syncInvoices({ dryRun: true });
      if (result.success) {
        setDryRunResult(result.data);
        setDryRunDialogOpen(true);
        toast.success(
          `Preview complete: ${result.data.totalProcessed} invoices analyzed`
        );
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to run dry run");
    } finally {
      setDryRunLoading(false);
    }
  }

  async function handleApplyFromDryRun() {
    setApplyLoading(true);
    toast.info("Starting Invoice-Period Matching sync...");
    try {
      const result = await triggerSync("invoice_period_matching");
      if (result.success) {
        toast.success("Invoice-Period Matching sync started");
        setDryRunDialogOpen(false);
        setDryRunResult(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to apply changes");
    } finally {
      setApplyLoading(false);
    }
  }

  return (
    <>
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
                  <TableCell className="text-muted-foreground text-xs font-mono">
                    {source.cronSchedule ?? "Manual only"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {source.lastEvent
                      ? formatRelativeTime(source.lastEvent.startedAt)
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

  async function handleSync() {
    setSyncLoading(true);
    toast.info("Starting Invoice-Period Matching sync...");
    try {
      const result = await triggerSync("invoice_period_matching");
      if (result.success) {
        toast.success("Invoice-Period Matching sync started");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to trigger sync");
    } finally {
      setSyncLoading(false);
    }
  }

  const loading = syncLoading || dryRunLoading;

  return (
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
  );
}
