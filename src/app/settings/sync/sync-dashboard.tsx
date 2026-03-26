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

/** Compare previous and updated sources; returns true if any event changed. */
function hasSourcesChanged(
  prev: SyncSourceWithLastEvent[],
  updated: SyncSourceWithLastEvent[]
): boolean {
  const prevMap = new Map(prev.map((s) => [s.sourceType, s]));
  return updated.some((s) => {
    const p = prevMap.get(s.sourceType);
    return (
      s.lastEvent?.outcome !== p?.lastEvent?.outcome ||
      s.lastEvent?.id !== p?.lastEvent?.id
    );
  });
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

  // Sync state when server data changes (e.g. after router.refresh())
  useEffect(() => {
    setSources(initialSources);
  }, [initialSources]);

  // Keep ref in sync
  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

  // Background polling (30s) — detect externally-triggered syncs (cron, API).
  // Depends on isPolling so it pauses while fast polling is active.
  useEffect(() => {
    const intervalId = setInterval(async () => {
      if (isPolling) return;
      if (document.hidden) return;

      const result = await getSyncStatus();
      if (!result.success) return;

      if (hasSourcesChanged(sourcesRef.current, result.data)) {
        setSources(result.data);
        if (result.data.some((s) => s.lastEvent?.outcome === "in_progress")) {
          setIsPolling(true);
        }
      }
    }, 30_000);

    return () => clearInterval(intervalId);
  }, [isPolling]);

  // Fast polling (5s) when any source is in_progress
  useEffect(() => {
    if (!isPolling) return;

    const intervalId = setInterval(async () => {
      const result = await getSyncStatus();
      if (!result.success) return;

      const updated = result.data;
      const prevMap = new Map(
        sourcesRef.current.map((s) => [s.sourceType, s])
      );

      // Show toasts for completion transitions
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

      if (hasSourcesChanged(sourcesRef.current, updated)) {
        setSources(updated);
      }

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
