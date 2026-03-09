"use client";

import { useState, useTransition } from "react";
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Power,
  PowerOff,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  enableCopilotSync,
  disableCopilotSync,
  triggerCopilotSync,
  getCopilotSyncStatus,
} from "@/actions/copilot";

interface CopilotSyncSectionProps {
  initialStatus: {
    enabled: boolean;
    lastSyncAt: string | null;
    lastSyncStatus: "completed" | "partial" | "failed" | null;
    nextScheduledSync: string | null;
    dataRange: { earliest: string; latest: string } | null;
    recordCounts: { metrics: number; billing: number; seats: number };
  };
}

function SyncStatusIndicator({
  status,
}: {
  status: "completed" | "partial" | "failed";
}) {
  switch (status) {
    case "completed":
      return (
        <span className="inline-flex items-center gap-1 text-green-600">
          <CheckCircle2 className="size-3" /> Completed
        </span>
      );
    case "partial":
      return (
        <span className="inline-flex items-center gap-1 text-amber-600">
          <AlertTriangle className="size-3" /> Partial
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 text-red-600">
          <XCircle className="size-3" /> Failed
        </span>
      );
  }
}

export function CopilotSyncSection({
  initialStatus,
}: CopilotSyncSectionProps) {
  const [status, setStatus] = useState(initialStatus);
  const [isPending, startTransition] = useTransition();

  function handleEnable() {
    startTransition(async () => {
      const result = await enableCopilotSync();
      if (result.success) {
        toast.success("Copilot sync enabled. Initial sync started.");
        setStatus((prev) => ({ ...prev, enabled: true }));
        // Refresh status after a brief delay to let sync start
        setTimeout(() => refreshStatus(), 2000);
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDisable() {
    startTransition(async () => {
      const result = await disableCopilotSync();
      if (result.success) {
        toast.success("Copilot sync disabled. Data preserved.");
        setStatus((prev) => ({ ...prev, enabled: false }));
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleSync() {
    startTransition(async () => {
      const result = await triggerCopilotSync();
      if (result.success) {
        toast.success("Sync started.");
        // Refresh status after sync has time to process
        setTimeout(() => refreshStatus(), 5000);
      } else {
        toast.error(result.error);
      }
    });
  }

  function refreshStatus() {
    startTransition(async () => {
      const result = await getCopilotSyncStatus();
      if (result.success) {
        setStatus(result.data);
      }
    });
  }

  // Render NOT enabled state
  if (!status.enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Copilot Data Sync</CardTitle>
          <CardDescription>
            Enable automatic syncing of GitHub Copilot usage data, seat
            assignments, and billing information.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Your GitHub token must include the{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              manage_billing:copilot
            </code>{" "}
            scope. Enabling sync will import Copilot data into your existing
            tools, assignments, and budget tracking.
          </p>
          <Button onClick={handleEnable} disabled={isPending}>
            <Power className="size-4 mr-2" />
            {isPending ? "Enabling..." : "Enable Copilot Sync"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Render ENABLED state
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Copilot Data Sync</CardTitle>
          <Badge variant="default">Enabled</Badge>
        </div>
        <CardDescription>
          Copilot data is synced daily. Last sync:{" "}
          {status.lastSyncAt
            ? new Date(status.lastSyncAt).toLocaleString()
            : "Never"}
          {status.lastSyncStatus && (
            <>
              {" "}
              &middot; Status:{" "}
              <SyncStatusIndicator status={status.lastSyncStatus} />
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Data Range */}
        {status.dataRange && (
          <div className="text-sm">
            <span className="font-medium">Data range:</span>{" "}
            {status.dataRange.earliest} to {status.dataRange.latest}
          </div>
        )}

        {/* Next Scheduled Sync */}
        {status.nextScheduledSync && (
          <div className="text-sm text-muted-foreground">
            Next scheduled sync:{" "}
            {new Date(status.nextScheduledSync).toLocaleString()}
          </div>
        )}

        {/* Record Counts */}
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-3 bg-muted rounded-lg">
            <div className="text-2xl font-bold">
              {status.recordCounts.metrics}
            </div>
            <div className="text-xs text-muted-foreground">Metric Days</div>
          </div>
          <div className="text-center p-3 bg-muted rounded-lg">
            <div className="text-2xl font-bold">
              {status.recordCounts.billing}
            </div>
            <div className="text-xs text-muted-foreground">
              Billing Snapshots
            </div>
          </div>
          <div className="text-center p-3 bg-muted rounded-lg">
            <div className="text-2xl font-bold">
              {status.recordCounts.seats}
            </div>
            <div className="text-xs text-muted-foreground">
              Seat Assignments
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button onClick={handleSync} disabled={isPending} size="sm">
            <RefreshCw
              className={`size-4 mr-2 ${isPending ? "animate-spin" : ""}`}
            />
            {isPending ? "Syncing..." : "Sync Now"}
          </Button>
          <Button
            onClick={refreshStatus}
            disabled={isPending}
            variant="outline"
            size="sm"
          >
            Refresh Status
          </Button>
          <Button
            onClick={handleDisable}
            disabled={isPending}
            variant="destructive"
            size="sm"
          >
            <PowerOff className="size-4 mr-2" />
            Disable
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
