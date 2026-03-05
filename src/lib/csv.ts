/**
 * CSV generation utility with RFC 4180 escaping and UTF-8 BOM support.
 */

/**
 * Escape a single CSV field per RFC 4180:
 * - Wrap in double quotes if the field contains commas, double quotes, or newlines.
 * - Double any internal double quotes.
 * - Convert null/undefined to empty string.
 */
export function escapeField(value: string | null | undefined): string {
  const str = value == null ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
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
