import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import type { SyncStatus } from "@/types";

type SyncStatusPillProps = {
  status: SyncStatus;
  className?: string;
};

export function SyncStatusPill({ status, className }: SyncStatusPillProps) {
  const { lastSyncedAt, isStale } = status;

  let tone: "green" | "amber" | "grey";
  let label: string;

  if (!lastSyncedAt) {
    tone = "grey";
    label = "Never synced";
  } else if (isStale) {
    tone = "amber";
    label = `Stale · ${formatDistanceToNow(lastSyncedAt, { addSuffix: true })}`;
  } else {
    tone = "green";
    // Hourly cron — surface "next in Xm" for predictability.
    const ageMin = status.ageMinutes ?? 0;
    const nextIn = Math.max(0, 60 - ageMin);
    label = `Synced ${formatDistanceToNow(lastSyncedAt, { addSuffix: true })} · next in ${nextIn}m`;
  }

  const toneClass =
    tone === "green"
      ? "bg-transparent text-success border-success"
      : tone === "amber"
      ? "bg-transparent text-warning border-warning"
      : "bg-transparent text-muted-foreground border-muted-foreground/20";

  const dotClass =
    tone === "green"
      ? "bg-success"
      : tone === "amber"
      ? "bg-warning"
      : "bg-muted-foreground";

  return (
    <Link
      href="/settings/sync"
      aria-live="polite"
      aria-label={`Anthropic sync status: ${label}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:opacity-90",
        toneClass,
        className
      )}
    >
      <span className={cn("size-1.5 rounded-full", dotClass)} aria-hidden />
      <span>{label}</span>
    </Link>
  );
}
