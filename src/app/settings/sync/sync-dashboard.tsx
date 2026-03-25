"use client";

import { useEffect, useRef, useState } from "react";
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
  const manualEvents = initialManualEvents;
  const sourcesRef = useRef(initialSources);
  const [sources, setSources] = useState(initialSources);
  const [isPolling, setIsPolling] = useState(() =>
    initialSources.some((s) => s.lastEvent?.outcome === "in_progress")
  );

  // Keep ref in sync
  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

  // Polling when any source is in_progress
  useEffect(() => {
    if (!isPolling) return;

    const intervalId = setInterval(async () => {
      const result = await getSyncStatus();
      if (!result.success) return;

      const updated = result.data;

      // Build a Map keyed by sourceType for stable lookups
      const prevMap = new Map(
        sourcesRef.current.map((s) => [s.sourceType, s])
      );

      // Check for completion transitions and show toasts
      for (const source of updated) {
        const prev = prevMap.get(source.sourceType);
        const prevOutcome = prev?.lastEvent?.outcome ?? null;
        const curOutcome = source.lastEvent?.outcome ?? null;

        if (prevOutcome === "in_progress" && curOutcome !== "in_progress") {
          const label = source.sourceType;
          if (curOutcome === "success" || curOutcome === "partial") {
            const ev = source.lastEvent;
            toast.success(
              `${label} complete: ${ev?.createdCount ?? 0} created, ${ev?.updatedCount ?? 0} updated`
            );
          } else if (curOutcome === "failed") {
            toast.error(
              `${label} failed: ${source.lastEvent?.errorMessage ?? "Unknown error"}`
            );
          }
        }
      }

      // Change detection — only update state if something actually changed
      const changed = updated.some((s) => {
        const prev = prevMap.get(s.sourceType);
        return (
          s.lastEvent?.outcome !== prev?.lastEvent?.outcome ||
          s.lastEvent?.createdCount !== prev?.lastEvent?.createdCount
        );
      });
      if (changed) setSources(updated);

      // If nothing is in_progress anymore, stop polling and refresh
      if (!updated.some((s) => s.lastEvent?.outcome === "in_progress")) {
        setIsPolling(false);
        router.refresh();
      }
    }, 5000);

    return () => clearInterval(intervalId);
  }, [isPolling, router]);

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold mb-3">Scheduled Jobs</h3>
        <ScheduledJobsTable sources={sources} />
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-3">Sync History</h3>
        <ManualJobsTable events={manualEvents} />
      </div>
    </div>
  );
}
