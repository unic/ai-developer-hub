import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  TrendingUp,
  TrendingDown,
  AlertCircle,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { Insight, InsightIcon } from "@/lib/reports/insights-static";

const ICON_MAP: Record<InsightIcon, typeof TrendingUp> = {
  "trend-up": TrendingUp,
  "trend-down": TrendingDown,
  warn: AlertCircle,
  shield: ShieldCheck,
  spark: Sparkles,
};

const SEVERITY_CLASSES: Record<Insight["severity"], string> = {
  info: "bg-muted text-muted-foreground",
  warn: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  danger: "bg-destructive/10 text-destructive",
};

interface WhatChangedProps {
  insights: Insight[];
}

export function WhatChanged({ insights }: WhatChangedProps) {
  if (insights.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>What changed this month</CardTitle>
        <CardDescription>
          Auto-generated from license + spend data · static rules (v1)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          {insights.map((insight) => {
            const Icon = ICON_MAP[insight.icon];
            return (
              <div
                key={insight.key}
                className="flex items-start gap-3 rounded-lg border bg-card/50 p-3"
              >
                <span
                  className={`flex size-8 shrink-0 items-center justify-center rounded-md ${
                    SEVERITY_CLASSES[insight.severity]
                  }`}
                  aria-hidden
                >
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{insight.headline}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {insight.body}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
