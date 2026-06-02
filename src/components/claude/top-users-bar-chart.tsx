"use client";

import { useRouter } from "next/navigation";
import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import type { UserListRow } from "@/types";

// Spectral palette fallback for users without a workspace display_color —
// mirrors `FALLBACK_PALETTE` in global-metrics-client.tsx so the two
// dashboards feel like the same family of visuals.
const FALLBACK_PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
];

const MUTED_GREY = "var(--muted-foreground)";

const config: ChartConfig = {
  cost: { label: "Cost", color: "var(--chart-1)" },
};

/**
 * Horizontal Top-10 users by cost bar chart.
 *
 * - Bar colour: monochrome ink by default (Nothing — rank is already encoded by
 *   length + order). When `useDbColors` is on (the card's "Use workspace colors"
 *   toggle), bars use the user's resolved workspace `display_color`, falling back
 *   to a greyscale rank ramp / muted grey.
 * - Click navigates to the per-user drill page at `/claude/users/N`.
 */
export function TopUsersBarChart({
  users,
  useDbColors = false,
}: {
  users: UserListRow[];
  useDbColors?: boolean;
}) {
  const router = useRouter();
  const top = users.filter((u) => u.costCents > 0).slice(0, 10);

  if (top.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No user spend recorded for this period yet.
      </p>
    );
  }

  const data = top.map((u, idx) => ({
    userId: u.userId,
    label: u.name || u.email,
    cost: u.costCents / 100,
    fill: resolveBarColor(u, idx, useDbColors),
  }));

  // Match the chart height to the bar count for readable horizontal layout.
  const height = Math.max(220, 40 * data.length + 24);

  return (
    <ChartContainer config={config} className="w-full" style={{ height }}>
      <BarChart
        data={data}
        layout="vertical"
        accessibilityLayer
        margin={{ top: 8, right: 56, bottom: 8, left: 8 }}
      >
        <XAxis
          type="number"
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => `$${value.toFixed(0)}`}
          tickMargin={4}
        />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          width={160}
          tickMargin={4}
          tick={{ fontSize: 12 }}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              numberFormat="currency"
            />
          }
        />
        <Bar
          dataKey="cost"
          radius={[0, 0, 0, 0]}
          maxBarSize={28}
          cursor="pointer"
        >
          {data.map((d, i) => (
            <Cell
              key={`top-user-${i}`}
              fill={d.fill}
              onClick={() => router.push(`/claude/users/${d.userId}`)}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

function resolveBarColor(
  user: UserListRow,
  idx: number,
  useDbColors: boolean
): string {
  // Monochrome default — uniform ink; rank is already shown by bar length/order.
  if (!useDbColors) return "var(--chart-1)";
  if (user.workspaceColor && user.workspaceColor.trim()) {
    return user.workspaceColor;
  }
  if (user.workspaceId !== null || user.workspaceName) {
    // Has a workspace, just no DB color — use the spectral palette by rank.
    return FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length];
  }
  return MUTED_GREY;
}
