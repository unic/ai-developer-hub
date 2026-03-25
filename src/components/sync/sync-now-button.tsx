"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { triggerSync } from "@/actions/sync";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { SyncSourceType } from "@/lib/sync/framework";

interface SyncNowButtonProps {
  sourceType: SyncSourceType;
  disabled?: boolean;
}

export function SyncNowButton({ sourceType, disabled }: SyncNowButtonProps) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleClick() {
    setLoading(true);
    try {
      const result = await triggerSync(sourceType);
      if (result.success) {
        toast.success("Sync started");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to trigger sync");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={disabled || loading}
    >
      <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />
      Sync
    </Button>
  );
}
