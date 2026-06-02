import { cn } from "@/lib/utils";

/**
 * The signature Nothing data viz — a bar of ~20 discrete segments rather than a
 * smooth fill. Mechanical, instrument-like. Always pair with a numeric readout.
 *
 * Fill tones map to status: neutral=ink (within range), good=success,
 * warn=warning, over=destructive (overflow past the limit). Empty = seg-empty.
 */
export type SegState = "empty" | "filled" | "good" | "warn" | "over";

const SEG_CLASS: Record<SegState, string> = {
  empty: "bg-seg-empty",
  filled: "bg-ink",
  good: "bg-success",
  warn: "bg-warning",
  over: "bg-destructive",
};

const SIZE_CLASS = {
  hero: "h-[18px]",
  default: "h-2.5",
  compact: "h-[5px]",
} as const;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Build a simple filled/empty state array from a 0..1 fraction. */
export function fractionStates(
  fraction: number,
  segments: number,
  tone: Exclude<SegState, "empty"> = "filled"
): SegState[] {
  const filled = Math.round(clamp01(fraction) * segments);
  return Array.from({ length: segments }, (_, i) =>
    i < filled ? tone : "empty"
  );
}

export function SegmentedBar({
  states,
  value,
  tone = "filled",
  segments = 20,
  size = "default",
  className,
  ariaLabel,
}: {
  /** Explicit per-segment states; overrides `value`. */
  states?: SegState[];
  /** Convenience: 0..1 fraction filled with `tone`. */
  value?: number;
  tone?: Exclude<SegState, "empty">;
  segments?: number;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
  ariaLabel?: string;
}) {
  const finalStates =
    states ?? fractionStates(value ?? 0, segments, tone);

  return (
    <div
      className={cn("flex w-full gap-0.5", SIZE_CLASS[size], className)}
      role="img"
      aria-label={ariaLabel}
    >
      {finalStates.map((s, i) => (
        <span key={i} className={cn("flex-1", SEG_CLASS[s])} />
      ))}
    </div>
  );
}
