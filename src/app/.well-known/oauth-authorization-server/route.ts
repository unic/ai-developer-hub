/**
 * RFC 8414 authorization-server metadata for the embedded MCP OAuth server
 * (038-mcp-v2). Public, CORS-open; excluded from the auth middleware matcher.
 */

import {
  authorizationServerMetadata,
  oauthJson,
  oauthPreflight,
  requestOrigin,
} from "@/lib/oauth/metadata";

export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  return oauthJson(authorizationServerMetadata(requestOrigin(req)));
}

export function OPTIONS(): Response {
  return oauthPreflight();
}
