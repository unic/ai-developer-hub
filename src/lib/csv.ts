/**
 * CSV generation utility with RFC 4180 escaping and UTF-8 BOM support.
 */

import { format } from "date-fns";

/**
 * Escape a single CSV field per RFC 4180:
 * - Wrap in double quotes if the field contains commas, double quotes, or newlines.
 * - Double any internal double quotes.
 * - Convert null/undefined to empty string.
 */
export function escapeField(value: string | null | undefined): string {
  const str = value == null ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert an array of string values into a CSV row string (no trailing newline).
 */
export function toCsvRow(fields: (string | null | undefined)[]): string {
  return fields.map(escapeField).join(",");
}

/**
 * Convert headers and rows into a full CSV string with UTF-8 BOM for Excel compatibility.
 */
export function toCsv(
  headers: string[],
  rows: (string | null | undefined)[][]
): string {
  const lines = [toCsvRow(headers), ...rows.map(toCsvRow)];
  return "\uFEFF" + lines.join("\r\n");
}

/**
 * Build a CSV download Response with appropriate headers.
 */
export function csvResponse(csv: string, filenamePrefix: string): Response {
  const today = format(new Date(), "yyyy-MM-dd");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filenamePrefix}-export-${today}.csv"`,
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
