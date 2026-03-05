"use client";

import { LineChart, Line } from "recharts";

interface SparklineProps {
  data: number[];
  color?: string;
}

export function Sparkline({ data, color = "var(--chart-1)" }: SparklineProps) {
  const chartData = data.map((v) => ({ value: v }));

  return (
    <LineChart width={80} height={32} data={chartData} accessibilityLayer>
      <Line
        type="monotone"
        dataKey="value"
        stroke={color}
        strokeWidth={1.5}
        dot={false}
        isAnimationActive={false}
      />
    </LineChart>
  );
}
