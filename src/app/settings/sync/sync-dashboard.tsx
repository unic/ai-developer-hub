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
import { SyncNowButton } from "@/components/sync/sync-now-button";
import { BackfillDialog } from "@/components/sync/backfill-dialog";
import type { SyncSourceWithLastEvent } from "@/lib/sync/registry";

const SOURCE_LABELS: Record<string, string> = {
  github_copilot_billing: "GitHub Copilot Billing",
  anthropic_api_usage: "Anthropic API Usage",
  anthropic_team_invoices: "Claude Team Invoices",
  github_members: "GitHub Members",
  invoice_period_matching: "Invoice-Period Matching",
  anthropic_workspace_sync: "Anthropic Workspace Sync",
};

const BACKFILL_SOURCES = [
  "github_copilot_billing",
  "anthropic_api_usage",
  "anthropic_workspace_sync",
];

function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return <Badge variant="secondary">Never synced</Badge>;
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    success: "default",
    partial: "outline",
    failed: "destructive",
    in_progress: "secondary",
  };
  return <Badge variant={variants[outcome] ?? "secondary"}>{outcome}</Badge>;
}

function formatDate(date: Date | string | null): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface SyncDashboardProps {
  sources: SyncSourceWithLastEvent[];
}

export function SyncDashboard({ sources }: SyncDashboardProps) {
  return (
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
          {sources.map((source) => (
            <TableRow key={source.sourceType}>
              <TableCell className="font-medium">
                {SOURCE_LABELS[source.sourceType] ?? source.sourceType}
              </TableCell>
              <TableCell className="text-muted-foreground text-xs font-mono">
                {source.cronSchedule ?? "Manual only"}
              </TableCell>
              <TableCell className="text-sm">
                {source.lastEvent
                  ? formatDate(source.lastEvent.startedAt)
                  : "Never synced"}
              </TableCell>
              <TableCell>
                <OutcomeBadge outcome={source.lastEvent?.outcome ?? null} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {source.lastEvent?.createdCount ?? "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {source.lastEvent?.updatedCount ?? "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {source.lastEvent?.skippedCount ?? "—"}
              </TableCell>
              <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                {source.lastEvent?.errorMessage ?? "—"}
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <SyncNowButton
                    sourceType={source.sourceType}
                    disabled={!source.enabled}
                  />
                  {BACKFILL_SOURCES.includes(source.sourceType) && (
                    <BackfillDialog
                      sourceType={source.sourceType}
                      disabled={!source.enabled}
                    />
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
