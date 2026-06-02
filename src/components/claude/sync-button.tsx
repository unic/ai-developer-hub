"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { syncWorkspacesManual } from "@/actions/anthropic-global";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
import { RefreshCw } from "lucide-react";

export function SyncButton() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const status = useInlineStatus();

  function handleSync() {
    startTransition(async () => {
      const result = await syncWorkspacesManual();
      if (result.success) {
        router.refresh();
      } else {
        status.error("Sync failed");
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <Button onClick={handleSync} disabled={isPending}>
        <RefreshCw
          className={`mr-2 size-4 ${isPending ? "animate-spin" : ""}`}
        />
        {isPending ? "Syncing…" : "Trigger Sync"}
      </Button>
      <StatusText status={status.status} />
    </div>
  );
}
