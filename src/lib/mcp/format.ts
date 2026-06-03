/**
 * Pure formatting helpers for the MCP server. No I/O, no DB — fully unit
 * testable. Monetary values in the Hub are stored as integer cents; MCP
 * responses surface both the raw cents and a derived USD number so clients can
 * choose precision vs. readability.
 */

import { centsToUsd } from "@/lib/utils";

// Re-exported so the MCP layer has a single import surface for formatting.
export { centsToUsd };

/**
 * MCP tool result shape (subset of the SDK's CallToolResult we use). The index
 * signature mirrors the SDK type (which allows `_meta` and other extras), so
 * this stays structurally assignable to a tool handler's expected return.
 */
export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * Attach a `<field>Usd` sibling for a `<field>Cents` value. Returns an object
 * spreadable into a response, e.g. `{ ...usd("total", 1234) }` →
 * `{ totalCents: 1234, totalUsd: 12.34 }`. A null amount yields nulls. The
 * generic field name flows through to the key names so consumers get precise
 * typed fields (`totalCents`/`totalUsd`) rather than a loose index signature.
 */
export function usd<Field extends string>(
  field: Field,
  cents: number | null | undefined,
): Record<`${Field}Cents` | `${Field}Usd`, number | null> {
  const value = cents ?? null;
  return {
    [`${field}Cents`]: value,
    [`${field}Usd`]: value === null ? null : centsToUsd(value),
  } as Record<`${Field}Cents` | `${Field}Usd`, number | null>;
}

/** Wrap a JSON-serializable value as a successful MCP text result. */
export function jsonResult(data: unknown): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

/** Wrap a message as an MCP error result (handler-level failure, not protocol). */
export function errorResult(message: string): McpToolResult {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * Run a data-assembly function and serialize the outcome, converting thrown
 * errors into a graceful `isError` result instead of a raw protocol error.
 */
export async function safeJsonResult(
  fn: () => Promise<unknown>,
): Promise<McpToolResult> {
  try {
    return jsonResult(await fn());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResult(message);
  }
}
