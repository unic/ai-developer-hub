"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getSyncStatus } from "@/actions/sync";
import { ScheduledJobsTable } from "./scheduled-jobs-table";
import { ManualJobsTable } from "./manual-jobs-table";
import type { SyncSourceWithLastEvent } from "@/lib/sync/registry";
import type { SyncEventRow } from "@/actions/sync";

interface SyncDashboardProps {
  initialSources: SyncSourceWithLastEvent[];
  initialManualEvents: SyncEventRow[];
}

export function SyncDashboard({
  initialSources,
  initialManualEvents,
}: SyncDashboardProps) {
  const router = useRouter();
  const [sources, setSources] = useState(initialSources);
  const [manualEvents] = useState(initialManualEvents);
  const previousOutcomesRef = useRef<Map<string, string | null>>(new Map());

  // Initialize previous outcomes on mount
  useEffect(() => {
    const map = new Map<string, string | null>();
    for (const source of initialSources) {
      map.set(source.sourceType, source.lastEvent?.outcome ?? null);
    }
    previousOutcomesRef.current = map;
  }, [initialSources]);

  const hasInProgress = useCallback(
    (srcList: SyncSourceWithLastEvent[]) =>
      srcList.some((s) => s.lastEvent?.outcome === "in_progress"),
    []
  );

  // Polling when any source is in_progress
  useEffect(() => {
    if (!hasInProgress(sources)) return;

    const intervalId = setInterval(async () => {
      const result = await getSyncStatus();
      if (!result.success) return;

      const updated = result.data;
      setSources(updated);

      // Check for completion transitions and show toasts
      for (const source of updated) {
        const prevOutcome = previousOutcomesRef.current.get(source.sourceType);
        const currentOutcome = source.lastEvent?.outcome ?? null;

        if (prevOutcome === "in_progress" && currentOutcome !== "in_progress") {
          const label = source.sourceType;
          if (currentOutcome === "success" || currentOutcome === "partial") {
            const ev = source.lastEvent;
            toast.success(
              `${label} complete: ${ev?.createdCount ?? 0} created, ${ev?.updatedCount ?? 0} updated`
            );
          } else if (currentOutcome === "failed") {
            toast.error(
              `${label} failed: ${source.lastEvent?.errorMessage ?? "Unknown error"}`
            );
          }
        }

        previousOutcomesRef.current.set(source.sourceType, currentOutcome);
      }

      // If nothing is in_progress anymore, refresh the page data
      if (!hasInProgress(updated)) {
        router.refresh();
      }
    }, 5000);

    return () => clearInterval(intervalId);
  }, [sources, hasInProgress, router]);

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold mb-3">Scheduled Jobs</h3>
        <ScheduledJobsTable sources={sources} />
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-3">Manual Jobs</h3>
        <ManualJobsTable events={manualEvents} />
      </div>
    </div>
  );
}
