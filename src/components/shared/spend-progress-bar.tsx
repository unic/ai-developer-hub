import { formatCurrency } from "@/lib/utils";
import { SegmentedBar, type SegState } from "@/components/ui/segmented-bar";

interface SpendProgressBarProps {
  actualYtd: number;
  ceiling: number;
  projectedAnnualTotal: number;
  /** When true, hides the $0/scale axis labels above the bar. */
  hideAxisLabels?: boolean;
}

const SEGMENTS = 24;

/**
 * Budget spend as a Nothing segmented bar (replaces the continuous fill).
 * Segments up to actual YTD are filled (ink); when projected exceeds the
 * ceiling, segments from the ceiling up to the projected total turn red
 * (over). The ceiling is marked with a tick. Same API as before, so the Budget
 * report At-a-Glance card and the admin Budget Health hero keep working.
 */
export function SpendProgressBar({
  actualYtd,
  ceiling,
  projectedAnnualTotal,
  hideAxisLabels = false,
}: SpendProgressBarProps) {
  if (ceiling === 0) return null;
  const scale = Math.max(ceiling, projectedAnnualTotal);
  const over = projectedAnnualTotal > ceiling;
  const ceilingPct = (ceiling / scale) * 100;

  const states: SegState[] = Array.from({ length: SEGMENTS }, (_, i) => {
    const segMid = ((i + 0.5) / SEGMENTS) * scale;
    if (segMid <= actualYtd) return "filled";
    if (over && segMid > ceiling && segMid <= projectedAnnualTotal) return "over";
    return "empty";
  });

  return (
    <div>
      {!hideAxisLabels && (
        <div className="flex items-baseline justify-between font-mono text-xs text-muted-foreground">
          <span>$0</span>
          <span>
            <span className="text-ink">{formatCurrency(scale)}</span>{" "}
            {over ? "projected" : "ceiling"}
          </span>
        </div>
      )}
      <div className="relative mt-3">
        <SegmentedBar
          states={states}
          size="hero"
          ariaLabel={`Actual ${((actualYtd / ceiling) * 100).toFixed(1)}% of ceiling`}
        />
        <div
          className="pointer-events-none absolute -top-3 bottom-0 flex flex-col items-center"
          style={{ left: `${ceilingPct}%`, transform: "translateX(-50%)" }}
          aria-hidden
          title={`Ceiling ${formatCurrency(ceiling)}`}
        >
          <span className="mb-0.5 whitespace-nowrap rounded-[4px] bg-ink px-1.5 py-px font-mono text-[10px] leading-none text-background">
            ceiling {formatCurrency(ceiling)}
          </span>
          <div className="w-px flex-1 bg-ink" />
        </div>
      </div>
    </div>
  );
}
