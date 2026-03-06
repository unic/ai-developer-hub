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

/** Compare importable user fields, return list of field names that differ */
export function getChangedUserFields(
  row: { name: string; circle?: string; role?: string; githubUsername?: string; profile?: string },
  existing: { name: string; circle: string | null; role: string; githubUsername: string | null; profile: string | null }
): string[] {
  const changed: string[] = [];
  if (row.name !== existing.name) changed.push("name");
  if (normalizeField(row.circle) !== existing.circle) changed.push("circle");
  if ((row.role || "viewer") !== existing.role) changed.push("role");
  if (normalizeField(row.githubUsername) !== existing.githubUsername) changed.push("githubUsername");
  if (normalizeField(row.profile) !== existing.profile) changed.push("profile");
  return changed;
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
