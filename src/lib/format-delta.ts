/**
 * Build a "+3 / -2 / ±0" delta payload for a KpiWithMom badge.
 */
export function buildDelta(delta: number): {
  label: string;
  variant: "up" | "down" | "flat";
} {
  if (delta === 0) return { label: "±0", variant: "flat" };
  return {
    label: `${delta > 0 ? "+" : ""}${delta}`,
    variant: delta > 0 ? "up" : "down",
  };
}

/**
 * Build a "+8.2% / -3.0%" delta payload for a KpiWithMom badge.
 *
 * @param flatThreshold Absolute percent below which the badge renders as
 *   "±0%". Defaults to 0.05 — same as the original reports inline helper,
 *   so swapping this in for that one is behavior-preserving.
 */
export function buildPctDelta(
  delta: number,
  base: number,
  flatThreshold = 0.05
): { label: string; variant: "up" | "down" | "flat" } {
  if (base === 0) return { label: "±0%", variant: "flat" };
  const pct = (delta / base) * 100;
  if (Math.abs(pct) < flatThreshold) return { label: "±0%", variant: "flat" };
  return {
    label: `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`,
    variant: pct > 0 ? "up" : "down",
  };
}
