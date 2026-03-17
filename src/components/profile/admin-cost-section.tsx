"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CostTrackingSection } from "./cost-tracking-section";
import { syncAnthropicUsage } from "@/actions/anthropic-usage";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
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

  async function handleSync() {
    setIsSyncing(true);
    try {
      const result = await syncAnthropicUsage(userId);
      if (result.success) {
        toast.success(
          `Synced ${result.data.syncedDays} days of usage data.`
        );
        // Refresh cost data after successful sync
        refreshRef.current?.();
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
    <CostTrackingSection
      userId={userId}
      initialData={initialData}
      availableMonths={availableMonths}
      showSummaryStats={false}
      headerActions={(onRefresh) => {
        refreshRef.current = onRefresh;
        return (
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
        );
      }}
    />
  );
}
