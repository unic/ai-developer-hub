"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { syncAllAnthropicUsage } from "@/actions/anthropic-usage";
import { toast } from "sonner";

export function SyncAllButton() {
  const [isSyncing, setIsSyncing] = useState(false);

  async function handleSyncAll() {
    setIsSyncing(true);
    try {
      const result = await syncAllAnthropicUsage();
      if (result.success) {
        const { syncedUsers, skippedUsers, errorCount } = result.data;
        toast.success(
          `Synced ${syncedUsers} user${syncedUsers !== 1 ? "s" : ""}` +
            (skippedUsers > 0 ? `, ${skippedUsers} skipped` : "") +
            (errorCount > 0 ? `, ${errorCount} error${errorCount !== 1 ? "s" : ""}` : "")
        );
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to sync usage data.");
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <Button variant="outline" onClick={handleSyncAll} disabled={isSyncing}>
      <RefreshCw
        className={`mr-2 size-4 ${isSyncing ? "animate-spin" : ""}`}
      />
      Sync Claude Costs
    </Button>
  );
}
