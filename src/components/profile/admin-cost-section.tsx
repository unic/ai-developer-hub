"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CostTrackingSection } from "./cost-tracking-section";
import { syncAnthropicUsage } from "@/actions/anthropic-usage";
import { RefreshCw } from "lucide-react";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
import type { CostData } from "@/types";

type AdminCostSectionProps = {
  userId: number;
  initialData: CostData;
  availableMonths: string[];
};

export function AdminCostSection({
  userId,
  initialData,
  availableMonths,
}: AdminCostSectionProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const refreshRef = useRef<(() => void) | null>(null);
  const status = useInlineStatus();

  async function handleSync() {
    setIsSyncing(true);
    status.pending("Syncing");
    try {
      const result = await syncAnthropicUsage(userId);
      if (result.success) {
        status.ok(`Synced ${result.data.syncedDays} days`);
        // Refresh cost data after successful sync
        refreshRef.current?.();
      } else {
        status.error(result.error);
      }
    } catch {
      status.error("Sync failed");
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <CostTrackingSection
      userId={userId}
      initialData={initialData}
      availableMonths={availableMonths}
      showSummaryStats={false}
      headerActions={(onRefresh) => {
        refreshRef.current = onRefresh;
        return (
          <div className="flex items-center gap-2">
            <StatusText status={status.status} />
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={isSyncing}
            >
              <RefreshCw
                className={`mr-1 size-4 ${isSyncing ? "animate-spin" : ""}`}
              />
              Sync
            </Button>
          </div>
        );
      }}
    />
  );
}
