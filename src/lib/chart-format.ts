/**
 * Display formatters for chart tooltips and axes.
 *
 * Currency is stored as integer USD cents in the data layer (see CLAUDE.md).
 * These helpers convert at the display boundary only.
 */

import { format, parseISO } from "date-fns";

import { formatCurrency } from "@/lib/utils";

export { formatCurrency };

export function formatCurrencyFromDollars(dollars: number): string {
  return formatCurrency(Math.round(dollars * 100));
}

export function formatUSDCompact(cents: number): string {
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(dollars / 1_000).toFixed(1)}k`;
  if (abs >= 100) return `$${dollars.toFixed(0)}`;
  return `$${dollars.toFixed(2)}`;
}

/** Accepts a fraction 0..1 — e.g. 0.42 → "42%". */
export function formatPercent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** Accepts a value already in percent units (0..100) — e.g. 42 → "42%". */
export function formatPercentRaw(percent: number, digits = 1): string {
  return `${percent.toFixed(digits)}%`;
}

export function formatInteger(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatDecimal2(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function toDate(input: string | Date): Date {
  if (typeof input !== "string") return input;
  if (input.length === 7) return parseISO(`${input}-01`);
  return parseISO(input);
}

/** "Friday, Mar 14, 2026". Accepts YYYY-MM-DD or Date. */
export function formatDateLong(input: string | Date): string {
  return format(toDate(input), "EEEE, MMM d, yyyy");
}

/** "Mar 14". */
export function formatDateShort(input: string | Date): string {
  return format(toDate(input), "MMM d");
}

/** "March 2026". Accepts YYYY-MM or YYYY-MM-DD. */
export function formatMonthLong(input: string | Date): string {
  return format(toDate(input), "MMMM yyyy");
}

/** "Mar '26". */
export function formatMonthShort(input: string | Date): string {
  return format(toDate(input), "MMM ''yy");
}

/**
 * Builds a tooltip `secondaryFormatter` that renders "NN% {suffix}" of total.
 * Returns null when total is zero so callers can drop the secondary line.
 */
export function shareOfTotalFormatter(
  suffix: string,
): (value: number | string, _item: unknown, total: number) => string | null {
  return (value, _item, total) => {
    if (total <= 0) return null;
    const pct = Math.round((Number(value) / total) * 100);
    return `${pct}% ${suffix}`;
  };
}

/** Built-in numberFormat presets supported by ChartTooltipContent. */
export type ChartNumberFormat =
  | "currency"
  | "currency-compact"
  | "percent"
  | "percent-raw"
  | "compact"
  | "integer"
  | "decimal2";

/**
 * Format a numeric value (or a string that parses to one) using a preset.
 * Returns the original value unchanged if it cannot be coerced to a number.
 *
 * `currency` expects DOLLARS (data already converted from cents).
 */
export function formatChartValue(
  value: number | string,
  fmt: ChartNumberFormat,
): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  switch (fmt) {
    case "currency":
      return formatCurrencyFromDollars(n);
    case "currency-compact":
      return formatUSDCompact(Math.round(n * 100));
    case "percent":
      return formatPercent(n);
    case "percent-raw":
      return formatPercentRaw(n);
    case "compact":
      return Math.abs(n) >= 1000
        ? `${(n / 1000).toFixed(1)}k`
        : formatInteger(n);
    case "integer":
      return formatInteger(Math.round(n));
    case "decimal2":
      return formatDecimal2(n);
  }
}
