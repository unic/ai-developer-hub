"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
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
        }
      } else {
        toast.error(result.error);
      }
      // Refresh server data so all status fields (syncedDays, timestamps, errors)
      // reflect the latest DB state
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Claude Console</CardTitle>
        <CardDescription>
          Sync Anthropic API usage costs for all users with configured API keys.
          {initialStatus.lastSyncCompletedAt && (
            <>
              {" "}
              Last sync:{" "}
              {new Date(initialStatus.lastSyncCompletedAt).toLocaleString()}
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status */}
        {initialStatus.lastSyncError && (
          <div className="flex items-center gap-2 text-sm text-red-600">
            <XCircle className="size-4" />
            Last sync error: {initialStatus.lastSyncError}
          </div>
        )}
        {initialStatus.lastSyncCompletedAt && !initialStatus.lastSyncError && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle2 className="size-4" />
            Last sync completed successfully
          </div>
        )}

        {/* Metrics */}
        <div className="grid grid-cols-1 gap-4">
          <div className="text-center p-3 bg-muted rounded-lg">
            <div className="text-2xl font-bold">{initialStatus.syncedDays}</div>
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
