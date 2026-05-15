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
        <span
          key={m.workspaceId ?? "__default__"}
          className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs text-destructive"
          title={`${m.name}: $${(m.priorCents / 100).toFixed(0)} → $${(m.currentCents / 100).toFixed(0)} over 6 months`}
        >
          <TrendingUp className="size-3" />
          <span className="font-medium">{m.name}</span>
          <span>+{m.deltaPct}%</span>
        </span>
      ))}
    </div>
  );
}
