/**
 * RFC 9728 protected-resource metadata for the MCP endpoint (038-mcp-v2).
 *
 * Catch-all because Claude probes the path-suffixed variant
 * (/.well-known/oauth-protected-resource/api/mcp/mcp) before falling back to
 * the root document — both serve the same metadata. Public, CORS-open.
 */

import {
  oauthJson,
  oauthPreflight,
  protectedResourceMetadata,
  requestOrigin,
} from "@/lib/oauth/metadata";

export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  return oauthJson(protectedResourceMetadata(requestOrigin(req)));
}

export function OPTIONS(): Response {
  return oauthPreflight();
}
