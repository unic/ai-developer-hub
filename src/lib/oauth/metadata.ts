/**
 * OAuth discovery documents for the embedded authorization server (038-mcp-v2).
 *
 * The issuer/origin is derived from the incoming request rather than an env
 * var so the documents are correct on production, Vercel previews, and local
 * dev without configuration (mirrors the NEXTAUTH_URL preview handling in
 * src/lib/auth.ts).
 */

import { MCP_SCOPE } from "@/lib/oauth/validate";

/** Path of the MCP Streamable HTTP endpoint this AS protects. */
const MCP_RESOURCE_PATH = "/api/mcp/mcp";

/**
 * In multi-hop proxy chains forwarded headers can be comma-separated lists
 * ("client-facing, hop2"); the first entry is the client-facing value.
 */
function firstForwardedValue(value: string | null): string | undefined {
  const first = value?.split(",")[0]?.trim();
  return first ? first : undefined;
}

/**
 * Derive the external origin (scheme://host) for an incoming request,
 * honouring reverse-proxy headers (Vercel sets x-forwarded-host/proto).
 */
export function requestOrigin(req: Request): string {
  const url = new URL(req.url);
  const host =
    firstForwardedValue(req.headers.get("x-forwarded-host")) ??
    req.headers.get("host") ??
    url.host;
  const proto =
    firstForwardedValue(req.headers.get("x-forwarded-proto")) ??
    url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** RFC 8414 authorization-server metadata. */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    scopes_supported: [MCP_SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
  };
}

/** RFC 9728 protected-resource metadata for the MCP endpoint. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}${MCP_RESOURCE_PATH}`,
    authorization_servers: [origin],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
  };
}

/** Shared CORS headers for the public discovery/registration/token endpoints. */
const OAUTH_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-protocol-version",
  "Access-Control-Max-Age": "86400",
} as const;

/** JSON response helper with CORS + no-store cache semantics. */
export function oauthJson(
  body: unknown,
  init?: { status?: number },
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      ...OAUTH_CORS_HEADERS,
    },
  });
}

/** Standard OPTIONS preflight response for the OAuth endpoints. */
export function oauthPreflight(): Response {
  return new Response(null, { status: 204, headers: OAUTH_CORS_HEADERS });
}
