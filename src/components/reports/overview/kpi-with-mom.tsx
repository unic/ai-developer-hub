"use client";

import dynamic from "next/dynamic";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const Sparkline = dynamic(
  () => import("@/components/reports/sparkline").then((m) => m.Sparkline),
  { ssr: false, loading: () => <div className="h-8 w-20" /> }
);

interface KpiWithMomProps {
  label: string;
  value: string;
  /** Free-text comparison line shown under the value. */
  comparison?: string;
  /** Badge content (e.g. "+22", "−3", "±0", "+8.2%"). */
  delta?: {
    label: string;
    variant: "up" | "down" | "flat";
  };
  /** Optional historical data for an inline sparkline (most-recent value last). */
  sparkline?: number[];
}

export function KpiWithMom({
  label,
  value,
  comparison,
  delta,
  sparkline,
}: KpiWithMomProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{label}</p>
            <div className="mt-1 flex items-baseline gap-2">
              <p className="text-2xl font-bold tabular-nums">{value}</p>
              {delta && (
                <Badge
                  variant={
                    delta.variant === "up"
                      ? "destructive"
                      : delta.variant === "down"
                        ? "default"
                        : "secondary"
                  }
                  className="font-mono text-[11px]"
                >
                  {delta.label}
                </Badge>
              )}
            </div>
            {comparison && (
              <p className="mt-1 text-xs text-muted-foreground">{comparison}</p>
            )}
          </div>
          {sparkline && sparkline.length > 1 && (
            <Sparkline data={sparkline} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
