"use client";

import { SegmentedBar } from "@/components/ui/segmented-bar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ActivityDistributionProps {
  data: {
    powerUsers: number;
    regularUsers: number;
    occasionalUsers: number;
    inactiveUsers: number;
  };
}

const SEGMENT_LABELS: Record<string, string> = {
  powerUsers: "Power Users (20+ days)",
  regularUsers: "Regular (5-19 days)",
  occasionalUsers: "Occasional (1-4 days)",
  inactiveUsers: "Inactive",
};

export function ActivityDistribution({ data }: ActivityDistributionProps) {
  const total =
    data.powerUsers +
    data.regularUsers +
    data.occasionalUsers +
    data.inactiveUsers;

  if (total === 0) {
    return null;
  }

  const pieData = [
    { name: "powerUsers", value: data.powerUsers },
    { name: "regularUsers", value: data.regularUsers },
    { name: "occasionalUsers", value: data.occasionalUsers },
    { name: "inactiveUsers", value: data.inactiveUsers },
  ].filter((d) => d.value > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Distribution</CardTitle>
        <CardDescription>
          User engagement levels across {total} total seats
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-5">
          {pieData.map((entry) => {
            const fraction = entry.value / total;
            const pct = Math.round(fraction * 100);
            const label = SEGMENT_LABELS[entry.name] ?? entry.name;
            return (
              <div key={entry.name} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                    {label}
                  </span>
                  <span className="font-mono text-sm tabular-nums">
                    {entry.value.toLocaleString()}
                    <span className="ml-2 text-muted-foreground">{pct}%</span>
                  </span>
                </div>
                <SegmentedBar
                  size="compact"
                  value={fraction}
                  ariaLabel={`${label}: ${entry.value} of ${total} seats (${pct}%)`}
                />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
