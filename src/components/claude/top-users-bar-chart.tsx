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
  "#d4f057",
  "#86efac",
  "#67e8f9",
  "#93c5fd",
  "#c4b5fd",
  "#f9a8d4",
  "#fcd34d",
  "#fdba74",
];

const MUTED_GREY = "var(--muted-foreground)";

const config: ChartConfig = {
  cost: { label: "Cost", color: "var(--chart-1)" },
};

/**
 * Horizontal Top-10 users by cost bar chart.
 *
 * - Bar colour: user's resolved workspace `display_color` when available,
 *   otherwise a spectral palette colour indexed by rank, otherwise muted grey
 *   for users without a workspace at all.
 * - Click navigates to the per-user drill page at `/claude/users/N`.
 */
export function TopUsersBarChart({ users }: { users: UserListRow[] }) {
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
    fill: resolveBarColor(u, idx),
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
              formatter={(value) => `$${Number(value).toFixed(2)}`}
            />
          }
        />
        <Bar
          dataKey="cost"
          radius={[0, 4, 4, 0]}
          maxBarSize={28}
          onClick={(payload: unknown) => {
            const item = payload as { userId?: number } | undefined;
            if (item?.userId != null) {
              router.push(`/claude/users/${item.userId}`);
            }
          }}
          cursor="pointer"
        >
          {data.map((d, i) => (
            <Cell key={`top-user-${i}`} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

function resolveBarColor(user: UserListRow, idx: number): string {
  if (user.workspaceColor && user.workspaceColor.trim()) {
    return user.workspaceColor;
  }
  if (user.workspaceId !== null || user.workspaceName) {
    // Has a workspace, just no DB color — use the spectral palette by rank.
    return FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length];
  }
  return MUTED_GREY;
}
