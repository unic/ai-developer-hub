import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function formatVariance(variance: number): string {
  if (variance > 0) return `+${formatCurrency(variance)}`;
  if (variance < 0) return `-${formatCurrency(Math.abs(variance))}`;
  return formatCurrency(0);
}

export function varianceClassName(variance: number): string {
  if (variance > 0) return "text-destructive";
  if (variance < 0) return "text-muted-foreground";
  return "";
}

/** Normalize an optional string field: empty/undefined/null → null */
export function normalizeField(value: string | undefined | null): string | null {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

/** Compare importable user fields, return list of field names that differ.
 *  Only considers optional fields when explicitly provided (not undefined). */
export function getChangedUserFields(
  row: {
    name: string;
    circle?: string;
    role?: string;
    discipline?: string;
    disciplineProvided?: boolean;
    githubUsername?: string;
    profile?: string;
  },
  existing: {
    name: string;
    circle: string | null;
    role: string;
    discipline: string;
    githubUsername: string | null;
    profile: string | null;
  }
): string[] {
  const changed: string[] = [];
  if (row.name !== existing.name) changed.push("name");
  if (row.circle !== undefined && normalizeField(row.circle) !== existing.circle) changed.push("circle");
  if (row.role !== undefined && row.role !== existing.role) changed.push("role");
  if (
    row.disciplineProvided &&
    row.discipline !== undefined &&
    row.discipline !== existing.discipline
  )
    changed.push("discipline");
  if (row.githubUsername !== undefined && normalizeField(row.githubUsername) !== existing.githubUsername) changed.push("githubUsername");
  if (row.profile !== undefined && normalizeField(row.profile) !== existing.profile) changed.push("profile");
  return changed;
}

export function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** End of the previous calendar month, 23:59:59.999 UTC. */
export function getLastMonthEnd(now: Date = new Date()): Date {
  const firstOfThisMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  return new Date(firstOfThisMonth.getTime() - 1);
}

/**
 * Linear extrapolation of month-to-date spending to a projected month-end total.
 * Returns 0 when daysElapsed is 0 to avoid divide-by-zero.
 */
export function projectMonthEnd(
  mtdCents: number,
  daysElapsed: number,
  daysInMonth: number
): number {
  if (daysElapsed === 0) return 0;
  return Math.round((mtdCents / daysElapsed) * daysInMonth);
}

export function formatDate(date: Date | string | null): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Format a Date to ISO date-only string (yyyy-MM-dd) for form values. */
export function formatDateOnly(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Format a Date to its UTC ISO date-only string (yyyy-MM-dd). Use this — not
 * `formatDateOnly` (local) — when comparing against the Anthropic cost tables,
 * which key calendar dates in UTC.
 */
export function formatUtcDateOnly(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Number of days in the UTC calendar month of `d`. Use this — not date-fns
 * `getDaysInMonth(d)` (local month) — when `daysElapsed` / the spend data are
 * keyed to UTC, so the projection denominator can't skew at a UTC month boundary.
 */
export function getUtcDaysInMonth(d: Date): number {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

// Sentinel values for faceted filters on nullable columns.
export const NO_CIRCLE_SENTINEL = "__no_circle__";
export const NO_PROFILE_SENTINEL = "__no_profile__";
export const NO_WORKSPACE_SENTINEL = "__no_workspace__";

/**
 * Report-specific normalization: null, empty string, "n/a", "none" (case-insensitive, trimmed) → null.
 * Stricter than `normalizeField` (which only collapses null/empty); used for grouping circles in
 * `/reports` so legacy "n/a"/"none" sentinels collapse with real nulls. Do not reuse for persistence
 * paths without coordinating, since user import/update flows currently rely on `normalizeField`.
 */
export function normalizeCircle(circle: string | null | undefined): string | null {
  if (circle === null || circle === undefined) return null;
  const trimmed = circle.trim();
  if (trimmed === "") return null;
  const lower = trimmed.toLowerCase();
  if (lower === "n/a" || lower === "none") return null;
  return trimmed;
}
