/**
 * RFC 7591 dynamic client registration for the embedded MCP OAuth server
 * (038-mcp-v2). Registration is unauthenticated by spec — a registered client
 * grants nothing by itself; every token still requires a logged-in Hub user
 * consenting on /oauth/authorize. Rate-limited per IP to blunt abuse.
 */

import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { oauthJson, oauthPreflight } from "@/lib/oauth/metadata";
import {
  clientRegistrationSchema,
  isAllowedRedirectUri,
} from "@/lib/oauth/validate";
import { registerClient } from "@/lib/oauth/store";

export const dynamic = "force-dynamic";

function registrationError(description: string): Response {
  return oauthJson(
    { error: "invalid_client_metadata", error_description: description },
    { status: 400 },
  );
}

export async function POST(req: Request): Promise<Response> {
  if (
    isRateLimited(`oauth-register:${clientIp(req.headers)}`, {
      maxAttempts: 10,
      windowMs: 10 * 60 * 1000,
    })
  ) {
    return oauthJson(
      { error: "invalid_client_metadata", error_description: "Rate limited" },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return registrationError("Request body must be JSON");
  }

  const parsed = clientRegistrationSchema.safeParse(body);
  if (!parsed.success) {
    return registrationError(
      parsed.error.issues[0]?.message ?? "Invalid client metadata",
    );
  }

  const invalidUri = parsed.data.redirect_uris.find(
    (uri) => !isAllowedRedirectUri(uri),
  );
  if (invalidUri !== undefined) {
    return registrationError(
      `redirect_uri not allowed (must be https, or http on a loopback host): ${invalidUri}`,
    );
  }

  const client = await registerClient({
    clientName: parsed.data.client_name ?? "MCP client",
    redirectUris: parsed.data.redirect_uris,
  });

  // Public client — no secret is ever issued.
  return oauthJson(
    {
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201 },
  );
}

export function OPTIONS(): Response {
  return oauthPreflight();
}
