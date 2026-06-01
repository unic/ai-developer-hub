// Spec 033 — shared presentational affordances for the "estimated today" figure.
// Always visually distinct from solid actuals: a dashed/ghost "est." chip with a
// tooltip explaining provenance. Kept tiny and client-safe so KPI strips, the
// org panel, and (indirectly) charts share one vocabulary.

import type { ReactNode } from "react";
import { formatCurrency } from "@/lib/utils";
import {
  CALIBRATION_LOOKBACK_DAYS,
  type TodayEstimate,
} from "@/lib/anthropic/estimate-today";

function relativeAge(asOfIso: string): string {
  const ageMin = Math.max(0, Math.floor((Date.now() - new Date(asOfIso).getTime()) / 60_000));
  if (ageMin < 1) return "just now";
  if (ageMin < 60) return `${ageMin}m ago`;
  const h = Math.floor(ageMin / 60);
  return `${h}h ago`;
}

/** Tooltip text mirroring mockup.html — provenance + the don't-reconcile caveat. */
export function estimateTooltip(estimate: TodayEstimate): string {
  const calibration = estimate.confident
    ? `calibrated ×${estimate.calibration.toFixed(2)} to the last ${CALIBRATION_LOOKBACK_DAYS} billed days`
    : "uncalibrated — not enough recent billed days to calibrate";
  return [
    `Estimated today: ${formatCurrency(estimate.cents)}.`,
    `Derived from today's per-user usage (${formatCurrency(estimate.rawUserCents)}), ${calibration}.`,
    `Updates hourly (synced ${relativeAge(estimate.asOfIso)}); replaced by the billed figure tomorrow.`,
    `Per-user and billed totals don't reconcile exactly.`,
  ].join(" ");
}

/** The dashed "est." chip — reuses the projection-ghost vocabulary (primary, dashed). */
export function EstChip({ estimate }: { estimate: TodayEstimate }) {
  return (
    <span
      className="inline-flex items-center rounded border border-dashed border-primary/60 bg-primary/10 px-1.5 py-0 text-[10px] font-medium text-primary"
      title={estimateTooltip(estimate)}
    >
      est.
    </span>
  );
}

/**
 * Caption fragment for a month-to-date / total tile: "incl. +$X est. today" with
 * the chip. The headline value itself stays the ACTUAL total — the estimate is
 * never merged into it (spec 033 guard); this line makes it explicit.
 */
export function InclEstTodayCaption({ estimate }: { estimate: TodayEstimate }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span>incl.</span>
      <span className="text-primary">+{formatCurrency(estimate.cents)} est. today</span>
      <EstChip estimate={estimate} />
    </span>
  );
}

/**
 * Caption for a "Total · {month}" KPI tile: the est-today sub-line when present,
 * otherwise the prior-month / first-month fallback. Shared by the org strip and
 * the workspace-detail strip so the two stay in lockstep.
 */
export function totalTileCaption(
  estimate: TodayEstimate | null | undefined,
  priorMonthCents: number
): ReactNode {
  if (estimate) return <InclEstTodayCaption estimate={estimate} />;
  return priorMonthCents > 0
    ? `Prior month ${formatCurrency(priorMonthCents)}`
    : "First month with data";
}
