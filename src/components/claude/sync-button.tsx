"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { syncWorkspacesManual } from "@/actions/anthropic-global";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

export function SyncButton() {
  const [isPending, startTransition] = useTransition();

  function handleSync() {
    startTransition(async () => {
      const result = await syncWorkspacesManual();
      if (result.success) {
        toast.success("Sync triggered successfully. Data will appear shortly.");
      } else {
        toast.error(`Sync failed: ${result.error}`);
      }
    });
  }

  return (
    <Button onClick={handleSync} disabled={isPending}>
      <RefreshCw className={`mr-2 size-4 ${isPending ? "animate-spin" : ""}`} />
      {isPending ? "Syncing…" : "Trigger Sync"}
    </Button>
  );
}
