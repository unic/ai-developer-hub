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
  row: { name: string; circle?: string; role?: string; githubUsername?: string; profile?: string },
  existing: { name: string; circle: string | null; role: string; githubUsername: string | null; profile: string | null }
): string[] {
  const changed: string[] = [];
  if (row.name !== existing.name) changed.push("name");
  if (row.circle !== undefined && normalizeField(row.circle) !== existing.circle) changed.push("circle");
  if (row.role !== undefined && row.role !== existing.role) changed.push("role");
  if (row.githubUsername !== undefined && normalizeField(row.githubUsername) !== existing.githubUsername) changed.push("githubUsername");
  if (row.profile !== undefined && normalizeField(row.profile) !== existing.profile) changed.push("profile");
  return changed;
}

export function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
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

/** Format a Date to ISO date-only string (yyyy-MM-dd) for form values. */
export function formatDateOnly(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Sentinel values for faceted filters on nullable columns.
export const NO_CIRCLE_SENTINEL = "__no_circle__";
export const NO_PROFILE_SENTINEL = "__no_profile__";
export const NO_WORKSPACE_SENTINEL = "__no_workspace__";
