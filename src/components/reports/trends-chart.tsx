"use client";

import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import type { PeriodSpendPoint } from "@/types";

const trendsConfig = {
  billedCents: { label: "Billed", color: "var(--chart-1)" },
  expectedCents: { label: "Expected", color: "var(--chart-2)" },
  plannedCents: { label: "Planned", color: "var(--chart-3)" },
} satisfies ChartConfig;

type Range = "3m" | "6m" | "12m";

interface TrendsChartProps {
  data: PeriodSpendPoint[];
}

export function TrendsChart({ data }: TrendsChartProps) {
  const [range, setRange] = useState<Range>("6m");

  const rangeMap: Record<Range, number> = { "3m": 3, "6m": 6, "12m": 12 };
  const filtered = data.slice(-rangeMap[range]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["3m", "6m", "12m"] as Range[]).map((r) => (
          <Button
            key={r}
            variant={range === r ? "default" : "outline"}
            size="sm"
            onClick={() => setRange(r)}
          >
            {r === "3m" ? "3 months" : r === "6m" ? "6 months" : "12 months"}
          </Button>
        ))}
      </div>
      <ChartContainer config={trendsConfig} className="min-h-[300px]">
        <LineChart data={filtered} accessibilityLayer>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" tick={{ fontSize: 12 }} />
          <YAxis
            tickFormatter={(v: number) => `$${(v / 100).toFixed(0)}`}
            tick={{ fontSize: 12 }}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value) =>
                  `$${((value as number) / 100).toFixed(2)}`
                }
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Line
            type="monotone"
            dataKey="billedCents"
            stroke="var(--color-billedCents)"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="expectedCents"
            stroke="var(--color-expectedCents)"
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="plannedCents"
            stroke="var(--color-plannedCents)"
            strokeWidth={2}
            strokeDasharray="2 4"
            dot={false}
            connectNulls
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}
