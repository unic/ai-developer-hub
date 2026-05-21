// Tiny pure helpers for card text. Whole-dollar money + percent/delta helpers
// are bespoke; precise money and relative-time helpers reuse the codebase's
// standard helpers (formatCurrency / date-fns formatDistanceToNow).

import { formatDistanceToNow } from "date-fns";

const USD_WHOLE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Whole-dollar formatting — "$18,420". Use formatCurrency() for 2-decimal. */
export function fmtMoney(cents: number): string {
  return USD_WHOLE.format(cents / 100);
}

export function fmtPct(pct: number | null): string {
  if (pct === null) return "—";
  return `${pct}%`;
}

export function fmtDeltaPct(pct: number | null): string {
  if (pct === null) return "—";
  if (pct > 0) return `▲ ${pct}%`;
  if (pct < 0) return `▼ ${Math.abs(pct)}%`;
  return "0%";
}

/** Relative age from minutes-ago — "1 min ago", "3 h ago". Returns "never" for null. */
export function fmtAgo(ageMinutes: number | null): string {
  if (ageMinutes === null) return "never";
  const date = new Date(Date.now() - ageMinutes * 60_000);
  return formatDistanceToNow(date, { addSuffix: true });
}
