"use client";

import { useMemo, useState } from "react";
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
import { parseMonthLabel } from "@/lib/forecast";
import { formatCurrency } from "@/lib/chart-format";

const trendsConfig = {
  billedCents: { label: "Billed", color: "var(--chart-1)" },
  expectedCents: { label: "Expected", color: "var(--chart-2)" },
  plannedCents: { label: "Planned", color: "var(--chart-3)" },
} satisfies ChartConfig;

type Range = "3m" | "6m" | "12m" | "all";

const RANGE_MAP = { "3m": 3, "6m": 6, "12m": 12 } as const;

const RANGE_LABELS: Record<Range, string> = {
  "3m": "3 months",
  "6m": "6 months",
  "12m": "12 months",
  "all": "All",
};

function getMonthFromLabel(label: string): { year: number; month: number } | null {
  const monthly = parseMonthLabel(label);
  if (monthly) return monthly;
  const q = label.match(/^Q([1-4])\s+(\d{4})$/);
  if (q) {
    const year = parseInt(q[2], 10);
    if (!isNaN(year)) return { year, month: (parseInt(q[1], 10) - 1) * 3 };
  }
  return null;
}

function findCurrentIndex(data: PeriodSpendPoint[]): number {
  const now = new Date();
  const cy = now.getFullYear();
  const cm = now.getMonth();
  let idx = data.length - 1;
  for (let i = 0; i < data.length; i++) {
    const parsed = getMonthFromLabel(data[i].month);
    if (!parsed) continue;
    if (parsed.year < cy || (parsed.year === cy && parsed.month <= cm)) {
      idx = i;
    }
  }
  return idx;
}

interface TrendsChartProps {
  data: PeriodSpendPoint[];
}

export function TrendsChart({ data }: TrendsChartProps) {
  const [range, setRange] = useState<Range>("3m");

  const filtered = useMemo(() => {
    if (range === "all") return data;
    const n = RANGE_MAP[range];
    const end = findCurrentIndex(data);
    return data.slice(Math.max(0, end - n + 1), end + 1);
  }, [data, range]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["3m", "6m", "12m", "all"] as Range[]).map((r) => (
          <Button
            key={r}
            variant={range === r ? "default" : "outline"}
            size="sm"
            onClick={() => setRange(r)}
          >
            {RANGE_LABELS[r]}
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
                valueFormatter={(v) => formatCurrency(Number(v))}
                indicator="line"
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
