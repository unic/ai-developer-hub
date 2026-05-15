import Link from "next/link";
import { TrendingUp } from "lucide-react";
import type { TopMover } from "@/types";

type TopMoversChipsProps = {
  movers: TopMover[];
};

export function TopMoversChips({ movers }: TopMoversChipsProps) {
  if (movers.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No growing workspaces (none have grown 6mo at &gt; $5 prior).
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {movers.map((m) => (
        <Link
          key={m.workspaceId ?? "__default__"}
          href={`/claude/workspaces/${m.workspaceId ?? "default"}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10"
          title={`${m.name}: $${(m.priorCents / 100).toFixed(0)} → $${(m.currentCents / 100).toFixed(0)} over 6 months`}
        >
          <TrendingUp className="size-3" />
          <span className="font-medium">{m.name}</span>
          <span className="text-muted-foreground">
            ${(m.priorCents / 100).toFixed(0)} → ${(m.currentCents / 100).toFixed(0)}
          </span>
          <span>+{m.deltaPct}%</span>
        </Link>
      ))}
    </div>
  );
}
