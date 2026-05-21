import { formatCurrency } from "@/lib/utils";

interface SpendProgressBarProps {
  actualYtd: number;
  ceiling: number;
  projectedAnnualTotal: number;
  /** When true, hides the $0/scale axis labels above the bar. */
  hideAxisLabels?: boolean;
}

/**
 * Stacked progress bar used by the Budget report's At-a-Glance card and by the
 * admin dashboard's Budget Health hero. When projected exceeds the ceiling,
 * the bar scales to the projected total so the overage stays inside the card
 * and the ceiling becomes a tick mark inside the bar.
 */
export function SpendProgressBar({
  actualYtd,
  ceiling,
  projectedAnnualTotal,
  hideAxisLabels = false,
}: SpendProgressBarProps) {
  if (ceiling === 0) return null;
  const scale = Math.max(ceiling, projectedAnnualTotal);
  const actualPct = (actualYtd / scale) * 100;
  const projectedPct = (projectedAnnualTotal / scale) * 100;
  const ceilingPct = (ceiling / scale) * 100;
  const over = projectedAnnualTotal > ceiling;

  return (
    <div>
      {!hideAxisLabels && (
        <div className="flex items-baseline justify-between text-xs text-muted-foreground">
          <span>$0</span>
          <span>
            <span className="font-medium text-foreground">
              {formatCurrency(scale)}
            </span>{" "}
            {over ? "projected" : "ceiling"}
          </span>
        </div>
      )}
      <div className="relative mt-2 pt-4">
        <div className="relative h-3 overflow-hidden rounded-full bg-muted">
          {over && (
            <div
              className="absolute inset-y-0 left-0 bg-destructive/40"
              style={{ width: `${projectedPct}%` }}
              aria-hidden
            />
          )}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary"
            style={{ width: `${actualPct}%` }}
            aria-label={`Actual ${((actualYtd / ceiling) * 100).toFixed(1)}% of ceiling`}
          />
        </div>
        {over && (
          <div
            className="pointer-events-none absolute -top-1 bottom-0 flex flex-col items-center"
            style={{ left: `${ceilingPct}%`, transform: "translateX(-50%)" }}
            aria-hidden
            title={`Ceiling ${formatCurrency(ceiling)}`}
          >
            <span className="mb-0.5 whitespace-nowrap rounded bg-foreground px-1.5 py-px text-[10px] font-medium leading-none text-background">
              ceiling {formatCurrency(ceiling)}
            </span>
            <div className="w-0.5 flex-1 bg-foreground" />
          </div>
        )}
      </div>
    </div>
  );
}
