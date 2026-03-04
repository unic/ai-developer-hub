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

export function formatDate(date: Date | string | null): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}
