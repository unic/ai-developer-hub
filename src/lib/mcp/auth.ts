/**
 * Authentication for the MCP server.
 *
 * The Hub uses shared bearer secrets for its machine-to-machine endpoints
 * (PROFILE_API_SECRET, CRON_SECRET, ...). The MCP server follows the same
 * convention via `MCP_SERVER_SECRET`, plugged into mcp-handler's
 * `withMcpAuth(handler, verifyMcpToken, { required: true })`.
 *
 * Dormant-by-default: when MCP_SERVER_SECRET is unset, every request is
 * rejected (verifyMcpToken returns undefined → 401) and a one-time warning is
 * logged, so the feature stays off until an operator provisions a secret.
 */

import { timingSafeEqual } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

/** Constant-time string comparison that is safe for unequal lengths. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Still run a comparison to avoid leaking length via early return timing.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

let warnedMissingSecret = false;

/**
 * Validate the bearer token presented by an MCP client against
 * MCP_SERVER_SECRET. Returns an AuthInfo on success or undefined on any
 * failure (missing secret, missing/invalid token), which mcp-handler maps to a
 * 401 response.
 */
export function verifyMcpToken(
  _req: Request,
  bearerToken?: string,
): AuthInfo | undefined {
  const secret = process.env.MCP_SERVER_SECRET;

  if (!secret) {
    if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      console.warn(
        "[mcp] MCP_SERVER_SECRET is not set — the MCP server is disabled and will reject all requests.",
      );
    }
    return undefined;
  }

  if (!bearerToken || !safeEqual(bearerToken, secret)) {
    return undefined;
  }

  return {
    token: bearerToken,
    clientId: "mcp-shared-secret",
    scopes: [],
  };
}
