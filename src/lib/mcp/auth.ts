/**
 * Authentication for the MCP server.
 *
 * Two parallel credential types (038-mcp-v2):
 *
 * 1. Shared secret — `MCP_SERVER_SECRET`, the original machine-to-machine
 *    convention (PROFILE_API_SECRET, CRON_SECRET, ...) for headless clients.
 * 2. OAuth access tokens (`mcp_at_…`) issued by the embedded authorization
 *    server, each bound to a Hub user; used by Claude Desktop / claude.ai /
 *    Claude Code connectors.
 *
 * When MCP_SERVER_SECRET is unset the shared-secret path is dormant (one-time
 * warning) but OAuth tokens still work — the server is enabled by either
 * mechanism independently.
 */

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import { ACCESS_TOKEN_PREFIX, verifyAccessToken } from "@/lib/oauth/store";
import { MCP_SCOPE, safeEqual } from "@/lib/oauth/validate";

// Re-exported for existing consumers/tests; implementation moved to
// src/lib/oauth/validate.ts so the OAuth layer can use it without a cycle.
export { safeEqual };

let warnedMissingSecret = false;

/**
 * Validate the bearer token presented by an MCP client. Checks the shared
 * MCP_SERVER_SECRET first, then OAuth access tokens issued by the embedded
 * authorization server. Returns an AuthInfo on success or undefined on any
 * failure, which mcp-handler maps to a 401 response.
 */
export async function verifyMcpToken(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;

  const secret = process.env.MCP_SERVER_SECRET;
  if (!secret && !warnedMissingSecret) {
    warnedMissingSecret = true;
    console.warn(
      "[mcp] MCP_SERVER_SECRET is not set — shared-secret MCP auth is disabled (OAuth tokens still work).",
    );
  }

  if (secret && safeEqual(bearerToken, secret)) {
    return {
      token: bearerToken,
      clientId: "mcp-shared-secret",
      scopes: [MCP_SCOPE],
      // The org-level secret is admin-equivalent by the spec-034 judgment
      // (039): role is asserted explicitly — never reached via fallback.
      extra: { role: "admin" },
    };
  }

  if (bearerToken.startsWith(ACCESS_TOKEN_PREFIX)) {
    const verified = await verifyAccessToken(bearerToken);
    if (verified) {
      return {
        token: bearerToken,
        clientId: verified.clientPublicId,
        scopes: verified.scope.split(" "),
        extra: {
          userId: verified.userId,
          email: verified.email,
          name: verified.name,
          role: verified.role,
        },
      };
    }
  }

  return undefined;
}
