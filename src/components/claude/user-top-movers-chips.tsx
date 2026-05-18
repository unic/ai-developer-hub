"use client";

import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { UserTopMover } from "@/types";

/**
 * "Fastest growing users (6mo)" chips.
 *
 * Mirrors `TopMoversChips` (workspace-level). Phase 3 rewires the chip to
 * navigate to the per-user drill page at `/claude/users/{userId}` — the chip
 * now drills in (Phase 2's table-filter trick is superseded by the dedicated
 * per-user route). `onSelect` is preserved as an optional escape hatch for
 * any caller that still wants the filter side-effect (it fires before the
 * Next.js Link's navigation).
 */
export function UserTopMoversChips({
  movers,
  onSelect,
}: {
  movers: UserTopMover[];
  /** Optional: fires before navigation; preserved for backwards compatibility. */
  onSelect?: (email: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Fastest growing users (6mo)</CardTitle>
      </CardHeader>
      <CardContent>
        {movers.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No users have grown 6mo at &gt; $5 prior period.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {movers.map((m) => {
              const label = m.name || m.email;
              return (
                <Link
                  key={m.userId}
                  href={`/claude/users/${m.userId}`}
                  onClick={() => onSelect?.(m.email)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10"
                  title={`${label}: $${(m.priorCents / 100).toFixed(0)} → $${(m.recentCents / 100).toFixed(0)} over 6 months`}
                  data-testid={`user-mover-chip-${m.userId}`}
                >
                  <TrendingUp className="size-3" />
                  <span className="font-medium">{label}</span>
                  <span className="text-muted-foreground tabular-nums">
                    ${(m.priorCents / 100).toFixed(0)} → ${(m.recentCents / 100).toFixed(0)}
                  </span>
                  <span className="tabular-nums">+{m.deltaPct}%</span>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
