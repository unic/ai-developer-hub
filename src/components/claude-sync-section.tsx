"use client";

import { useState, useTransition } from "react";
import { RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { syncAllAnthropicUsage } from "@/actions/anthropic-usage";

interface ClaudeSyncSectionProps {
  initialStatus: {
    lastSyncCompletedAt: string | null;
    lastSyncError: string | null;
    syncedDays: number;
  };
}

export function ClaudeSyncSection({
  initialStatus,
}: ClaudeSyncSectionProps) {
  const [status, setStatus] = useState(initialStatus);
  const [isPending, startTransition] = useTransition();

  function handleSync() {
    startTransition(async () => {
      const result = await syncAllAnthropicUsage();
      if (result.success) {
        const { syncedUsers, skippedUsers, errorCount, firstError } =
          result.data;
        if (errorCount > 0 && syncedUsers === 0) {
          toast.error(
            firstError ?? `Sync failed with ${errorCount} error(s)`
          );
        } else {
          toast.success(
            `Synced ${syncedUsers} user${syncedUsers !== 1 ? "s" : ""}` +
              (skippedUsers > 0 ? `, ${skippedUsers} skipped` : "") +
              (errorCount > 0
                ? `, ${errorCount} error${errorCount !== 1 ? "s" : ""}`
                : "")
          );
          setStatus((prev) => ({
            ...prev,
            lastSyncCompletedAt: new Date().toISOString(),
            lastSyncError: errorCount > 0 ? firstError : null,
          }));
        }
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Claude Console</CardTitle>
        <CardDescription>
          Sync Anthropic API usage costs for all users with configured API keys.
          {status.lastSyncCompletedAt && (
            <>
              {" "}
              Last sync:{" "}
              {new Date(status.lastSyncCompletedAt).toLocaleString()}
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status */}
        {status.lastSyncError && (
          <div className="flex items-center gap-2 text-sm text-red-600">
            <XCircle className="size-4" />
            Last sync error: {status.lastSyncError}
          </div>
        )}
        {status.lastSyncCompletedAt && !status.lastSyncError && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle2 className="size-4" />
            Last sync completed successfully
          </div>
        )}

        {/* Metrics */}
        <div className="grid grid-cols-1 gap-4">
          <div className="text-center p-3 bg-muted rounded-lg">
            <div className="text-2xl font-bold">{status.syncedDays}</div>
            <div className="text-xs text-muted-foreground">Synced Days</div>
          </div>
        </div>

        {/* Actions */}
        <Button onClick={handleSync} disabled={isPending} size="sm">
          <RefreshCw
            className={`size-4 mr-2 ${isPending ? "animate-spin" : ""}`}
          />
          {isPending ? "Syncing..." : "Sync All Costs"}
        </Button>
      </CardContent>
    </Card>
  );
}
