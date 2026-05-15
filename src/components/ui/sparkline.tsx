import { cn } from "@/lib/utils";

type SparklineProps = {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
  ariaLabel?: string;
  className?: string;
};

/**
 * Hand-rolled inline-SVG sparkline. Avoids Recharts' instance overhead
 * when rendering many sparklines (e.g. per-workspace row).
 *
 * Renders an em-dash when fewer than 2 data points are available.
 */
export function Sparkline({
  data,
  color = "currentColor",
  height = 28,
  width = 96,
  ariaLabel,
  className,
}: SparklineProps) {
  if (data.length < 2) {
    return (
      <span
        role="img"
        aria-label={ariaLabel ?? "Insufficient data for sparkline"}
        className={cn("inline-block text-muted-foreground", className)}
        style={{ width, height }}
      >
        —
      </span>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = data.length === 1 ? width : width / (data.length - 1);
  const points = data
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      role="img"
      aria-label={
        ariaLabel ??
        `Sparkline showing trend across ${data.length} data points`
      }
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      style={{ color }}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={(data.length - 1) * stepX}
        cy={height - ((data[data.length - 1] - min) / range) * height}
        r="1.5"
        fill="currentColor"
      />
    </svg>
  );
}
