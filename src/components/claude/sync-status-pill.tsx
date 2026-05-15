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
    label = `Synced ${formatDistanceToNow(lastSyncedAt, { addSuffix: true })}`;
  }

  const toneClass =
    tone === "green"
      ? "bg-emerald-950/40 text-emerald-400 border-emerald-800"
      : tone === "amber"
      ? "bg-amber-950/40 text-amber-400 border-amber-800"
      : "bg-muted text-muted-foreground border-muted-foreground/20";

  const dotClass =
    tone === "green"
      ? "bg-emerald-500"
      : tone === "amber"
      ? "bg-amber-500"
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
