"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { ActiveAlertsData } from "@/types";

const STORAGE_KEY = "alert-banner-dismissed";

function computeFingerprint(alerts: ActiveAlertsData): string {
  return alerts.workspaceAlerts
    .map((a) => `${a.workspaceId ?? "default"}:${a.utilizationPct}`)
    .sort()
    .join("|");
}

// Nothing alert: a FLAT bordered status box — no red background fill. The border
// carries severity (destructive critical / warning approaching); status color is
// on the value text only. Keeps the localStorage fingerprint dismiss + aria-live.
export function AlertBanner({ alerts }: { alerts: ActiveAlertsData | null }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [announced, setAnnounced] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setDismissed(localStorage.getItem(STORAGE_KEY));
    }
    setAnnounced(true);
  }, []);

  const hasAlerts = !!alerts && alerts.workspaceAlerts.length > 0;
  const fingerprint = hasAlerts ? computeFingerprint(alerts) : "";
  const showBanner = hasAlerts && dismissed !== fingerprint;
  const count = hasAlerts ? alerts.workspaceAlerts.length : 0;
  const hasCritical =
    hasAlerts && alerts.workspaceAlerts.some((a) => a.severity === "critical");

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, fingerprint);
    setDismissed(fingerprint);
  };

  return (
    <>
      {/* Always-mounted live region: keeping it in the DOM means a
          none→alerts transition reads as a content change (the initial content
          of a freshly inserted live region isn't reliably announced). */}
      <div aria-live="polite" className="sr-only">
        {announced && showBanner
          ? `${count} budget alert${count > 1 ? "s" : ""}`
          : ""}
      </div>
      {showBanner && alerts ? (
        <div role="region" aria-label="Budget alerts" className="px-5 pt-6 sm:px-8">
          <div
            className={cn(
              "relative rounded-lg border bg-transparent px-4 py-3",
              hasCritical ? "border-destructive" : "border-warning"
            )}
          >
            <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-muted-foreground">
              Budget Alert
            </span>
            <ul className="mt-2 space-y-1">
              {alerts.workspaceAlerts.map((a, i) => (
                <li key={i} className="font-mono text-xs">
                  <span
                    className={
                      a.severity === "critical"
                        ? "text-destructive"
                        : "text-warning"
                    }
                  >
                    {a.name}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    is at {a.utilizationPct}% of monthly budget
                    {a.severity === "critical"
                      ? " — limit exceeded"
                      : " — approaching limit"}
                  </span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss budget alerts"
              className="absolute right-2 top-2 rounded-[4px] px-2 py-1 font-mono text-[11px] tracking-[0.1em] uppercase text-faint transition-colors hover:text-foreground"
            >
              [ X ]
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
