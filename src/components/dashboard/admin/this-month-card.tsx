import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { AdminThisMonthSnapshot } from "@/actions/dashboard";

interface ThisMonthCardProps {
  snapshot: AdminThisMonthSnapshot;
}

export function ThisMonthCard({ snapshot }: ThisMonthCardProps) {
  if (!snapshot.periodLabel) {
    return (
      <Card>
        <CardContent className="space-y-2 pt-6">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            This month
          </p>
          <p className="text-sm text-muted-foreground">
            No current budget period.
          </p>
        </CardContent>
      </Card>
    );
  }

  const over = snapshot.variancePct !== null && snapshot.variancePct > 0;
  const under = snapshot.variancePct !== null && snapshot.variancePct < 0;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              This month
            </p>
            <p className="text-lg font-semibold">{snapshot.periodLabel}</p>
          </div>
          <Calendar className="size-4 text-muted-foreground" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Actual so far
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {formatCurrency(snapshot.actualCents)}
            </p>
            {snapshot.runningCents > 0 && (
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {formatCurrency(snapshot.billedCents)} billed +{" "}
                {formatCurrency(snapshot.runningCents)} API
              </p>
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Planned
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {formatCurrency(snapshot.plannedCents)}
            </p>
            {snapshot.variancePct !== null && (
              <div className="mt-0.5">
                <Badge
                  variant={over ? "destructive" : under ? "default" : "secondary"}
                  className="font-mono text-[11px]"
                >
                  {snapshot.variancePct >= 0 ? "+" : ""}
                  {snapshot.variancePct.toFixed(1)}%{" "}
                  {over ? "over" : under ? "under" : "to plan"}
                </Badge>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
