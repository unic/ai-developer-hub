"use client";

import { useState } from "react";
import { triggerCopilotSync } from "@/actions/copilot";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export function BillingSyncButton() {
  const [isSyncing, setIsSyncing] = useState(false);
  const router = useRouter();

  async function handleSync() {
    setIsSyncing(true);
    try {
      const result = await triggerCopilotSync();
      if (result.success) {
        toast.success("Billing sync completed successfully.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("An unexpected error occurred during sync.");
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <Button onClick={handleSync} disabled={isSyncing} size="sm" variant="outline">
      <RefreshCw className={`mr-2 size-4 ${isSyncing ? "animate-spin" : ""}`} />
      {isSyncing ? "Syncing..." : "Sync Now"}
    </Button>
  );
}
