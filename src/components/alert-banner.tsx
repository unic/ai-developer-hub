"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, X } from "lucide-react";
import type { ActiveAlertsData } from "@/types";

const STORAGE_KEY = "alert-banner-dismissed";

function computeFingerprint(alerts: ActiveAlertsData): string {
  return alerts.workspaceAlerts
    .map((a) => `${a.workspaceId ?? "default"}:${a.utilizationPct}`)
    .sort()
    .join("|");
}

export function AlertBanner({ alerts }: { alerts: ActiveAlertsData | null }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [announced, setAnnounced] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setDismissed(localStorage.getItem(STORAGE_KEY));
    }
    setAnnounced(true);
  }, []);

  if (!alerts || alerts.workspaceAlerts.length === 0) return null;

  const fingerprint = computeFingerprint(alerts);
  if (dismissed === fingerprint) return null;

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, fingerprint);
    setDismissed(fingerprint);
  };

  return (
    <div role="region" aria-label="Budget alerts" className="border-b bg-background px-4 py-2">
      <div aria-live="polite" className="sr-only">
        {!announced && `${alerts.workspaceAlerts.length} budget alert${alerts.workspaceAlerts.length > 1 ? "s" : ""}`}
      </div>
      <Alert variant="destructive" className="relative border-0 bg-transparent py-2">
        <AlertTriangle className="size-4" />
        <AlertTitle>Budget Alert</AlertTitle>
        <AlertDescription>
          <ul className="mt-1 space-y-0.5 text-sm">
            {alerts.workspaceAlerts.map((a, i) => (
              <li key={i}>
                <span className={a.severity === "critical" ? "font-semibold text-destructive" : "text-yellow-600 dark:text-yellow-500"}>
                  {a.name}
                </span>
                {" "}is at {a.utilizationPct}% of monthly budget
                {a.severity === "critical" ? " — limit exceeded!" : " — approaching limit"}
              </li>
            ))}
          </ul>
        </AlertDescription>
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-2 top-2 size-6"
          onClick={handleDismiss}
          aria-label="Dismiss budget alerts"
        >
          <X className="size-3" />
        </Button>
      </Alert>
    </div>
  );
}
