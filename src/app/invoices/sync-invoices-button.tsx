"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2 } from "lucide-react";
import { syncInvoices } from "@/actions/invoice-sync";
import { SyncResultsDialog } from "./sync-results-dialog";
import { toast } from "sonner";
import type { SyncResult } from "@/types";

export function SyncInvoicesButton() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [isDryRun, setIsDryRun] = useState(false);

  async function handleSync(dryRun: boolean) {
    setIsSyncing(true);
    setIsDryRun(dryRun);
    try {
      const res = await syncInvoices({ dryRun });
      if (res.success) {
        setResult(res.data);
        setShowResults(true);
      } else {
        toast.error(res.error);
      }
    } catch {
      toast.error("Sync failed unexpectedly");
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleConfirmDryRun() {
    setShowResults(false);
    await handleSync(false);
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => handleSync(false)}
        disabled={isSyncing}
      >
        {isSyncing ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 size-4" />
        )}
        Sync Invoices
      </Button>

      <SyncResultsDialog
        open={showResults}
        onOpenChange={setShowResults}
        result={result}
        isDryRun={isDryRun}
        onConfirm={handleConfirmDryRun}
      />
    </>
  );
}
