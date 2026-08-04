"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSyncStatus } from "@/actions/sync";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
import { ScheduledJobsTable } from "./scheduled-jobs-table";
import { ManualJobsTable } from "./manual-jobs-table";
import type { SyncSourceWithLastEvent } from "@/lib/sync/registry";
import type { SyncEventRow } from "@/actions/sync";

interface SyncDashboardProps {
  initialSources: SyncSourceWithLastEvent[];
  initialManualEvents: SyncEventRow[];
}

/**
 * How long the 5s fast poll may run before giving up.
 *
 * The fast poll used to exit only when nothing was `in_progress`. A sync whose
 * process died mid-run leaves that row `in_progress` permanently, so every open
 * admin tab queried the database every 5 seconds indefinitely — a
 * self-inflicted, self-sustaining load that outlived the sync that caused it.
 * Server-side reaping now terminates such rows, but the client must not depend
 * on that to stop polling.
 */
const MAX_FAST_POLL_MS = 10 * 60 * 1000;

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
  const status = useInlineStatus();
  const manualEvents = initialManualEvents;
  const sourcesRef = useRef(initialSources);
  const [sources, setSources] = useState(initialSources);
  // Events we have stopped waiting on. Without this the 30s loop below would
  // immediately re-arm fast polling on the very row the fast loop just gave up
  // on, restoring the infinite cycle. Keyed by event id so a genuinely NEW run
  // still re-arms.
  const abandonedEventIdsRef = useRef<Set<number>>(new Set());
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
        const hasFreshInProgress = result.data.some(
          (s) =>
            s.lastEvent?.outcome === "in_progress" &&
            !abandonedEventIdsRef.current.has(s.lastEvent.id)
        );
        if (hasFreshInProgress) {
          setIsPolling(true);
        }
      }
    }, 30_000);

    return () => clearInterval(intervalId);
  }, [isPolling]);

  // Fast polling (5s) when any source is in_progress
  useEffect(() => {
    if (!isPolling) return;

    const startedAt = Date.now();

    const intervalId = setInterval(async () => {
      // Background tabs contributed the same 5s query load as focused ones.
      if (document.hidden) return;

      if (Date.now() - startedAt > MAX_FAST_POLL_MS) {
        for (const source of sourcesRef.current) {
          if (source.lastEvent?.outcome === "in_progress") {
            abandonedEventIdsRef.current.add(source.lastEvent.id);
          }
        }
        setIsPolling(false);
        status.error(
          "A sync has been in progress for over 10 minutes — stopped auto-refreshing. Reload to check again."
        );
        return;
      }

      const result = await getSyncStatus();
      if (!result.success) return;

      const updated = result.data;
      const prevMap = new Map(
        sourcesRef.current.map((s) => [s.sourceType, s])
      );

      // Show inline status for completion transitions
      for (const source of updated) {
        const prev = prevMap.get(source.sourceType);
        const prevOutcome = prev?.lastEvent?.outcome ?? null;
        const curOutcome = source.lastEvent?.outcome ?? null;

        if (prevOutcome === "in_progress" && curOutcome !== "in_progress") {
          const label = source.sourceType;
          if (curOutcome === "success" || curOutcome === "partial") {
            const ev = source.lastEvent;
            status.ok(
              `${label} done: ${ev?.createdCount ?? 0} new, ${ev?.updatedCount ?? 0} updated`
            );
          } else if (curOutcome === "failed") {
            status.error(`${label} failed`);
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
  }, [isPolling, router, status]);

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-3 flex items-center gap-3">
          <h3 className="text-lg font-semibold">Scheduled Jobs</h3>
          <StatusText status={status.status} />
        </div>
        <ScheduledJobsTable sources={sources} />
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-3">Sync History</h3>
        <ManualJobsTable events={manualEvents} />
      </div>
    </div>
  );
}
