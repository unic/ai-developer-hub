"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { triggerSync } from "@/actions/sync";
import { useRouter } from "next/navigation";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
import type { SyncSourceType } from "@/lib/sync/framework";

interface SyncNowButtonProps {
  sourceType: SyncSourceType;
  disabled?: boolean;
}

export function SyncNowButton({ sourceType, disabled }: SyncNowButtonProps) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const status = useInlineStatus();

  async function handleClick() {
    setLoading(true);
    try {
      const result = await triggerSync(sourceType);
      if (result.success) {
        status.ok("Sync started");
        router.refresh();
      } else {
        status.error(result.error);
      }
    } catch {
      status.error("Sync failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleClick}
        disabled={disabled || loading}
      >
        <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />
        Sync
      </Button>
      <StatusText status={status.status} />
    </div>
  );
}
