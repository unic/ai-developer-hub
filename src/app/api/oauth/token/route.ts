/**
 * OAuth 2.1 token endpoint for the embedded MCP authorization server
 * (038-mcp-v2). Public clients only (token_endpoint_auth_method "none") —
 * possession is proven by PKCE on the authorization-code grant and by the
 * rotating refresh token afterwards.
 *
 * Accepts application/x-www-form-urlencoded per RFC 6749 §4.1.3 and returns
 * RFC 6749 §5.2 error codes (Claude specifically distinguishes invalid_grant
 * to know when to restart the flow).
 */

import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { oauthJson, oauthPreflight } from "@/lib/oauth/metadata";
import { verifyPkce } from "@/lib/oauth/validate";
import {
  consumeAuthCode,
  getClientByPublicId,
  issueTokens,
  rotateRefreshToken,
  type IssuedTokens,
} from "@/lib/oauth/store";

export const dynamic = "force-dynamic";

function tokenError(
  error: "invalid_request" | "invalid_client" | "invalid_grant" | "unsupported_grant_type",
  description: string,
): Response {
  return oauthJson(
    { error, error_description: description },
    { status: error === "invalid_client" ? 401 : 400 },
  );
}

function tokenSuccess(tokens: IssuedTokens): Response {
  return oauthJson({
    access_token: tokens.accessToken,
    token_type: "Bearer",
    expires_in: tokens.expiresIn,
    refresh_token: tokens.refreshToken,
    scope: tokens.scope,
  });
}

export async function POST(req: Request): Promise<Response> {
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await req.text());
  } catch {
    return tokenError("invalid_request", "Malformed request body");
  }

  const grantType = form.get("grant_type");
  const clientId = form.get("client_id");

  // Hosted Claude egresses many tenants through one IP range, so the limiter
  // is keyed on IP + client to avoid cross-tenant lockout.
  if (
    isRateLimited(`oauth-token:${clientIp(req.headers)}:${clientId ?? "none"}`, {
      maxAttempts: 60,
      windowMs: 10 * 60 * 1000,
    })
  ) {
    // 429 (not an OAuth error code) so clients back off instead of treating
    // throttling as a permanent request error.
    return oauthJson(
      { error: "invalid_request", error_description: "Rate limited" },
      { status: 429 },
    );
  }

  if (!clientId) {
    return tokenError("invalid_request", "client_id is required");
  }
  const client = await getClientByPublicId(clientId);
  if (!client) {
    return tokenError("invalid_client", "Unknown client");
  }

  if (grantType === "authorization_code") {
    const code = form.get("code");
    const codeVerifier = form.get("code_verifier");
    const redirectUri = form.get("redirect_uri");

    if (!code || !codeVerifier || !redirectUri) {
      return tokenError(
        "invalid_request",
        "code, code_verifier and redirect_uri are required",
      );
    }

    // Client binding is part of the consume predicate, so a code presented
    // by the wrong client is refused without being burned.
    const consumed = await consumeAuthCode(code, client.id);
    if (!consumed) {
      return tokenError("invalid_grant", "Authorization code is invalid, expired, or already used");
    }

    // Must be byte-identical to the URI used on the authorize request
    // (RFC 6749 §4.1.3) — the loopback-port relaxation applies only between
    // registration and authorization, not here.
    if (consumed.redirectUri !== redirectUri) {
      return tokenError("invalid_grant", "redirect_uri does not match the authorization request");
    }

    if (!verifyPkce(codeVerifier, consumed.codeChallenge)) {
      return tokenError("invalid_grant", "PKCE verification failed");
    }

    const tokens = await issueTokens({
      clientRowId: client.id,
      userId: consumed.userId,
      scope: consumed.scope,
    });
    return tokenSuccess(tokens);
  }

  if (grantType === "refresh_token") {
    const refreshToken = form.get("refresh_token");
    if (!refreshToken) {
      return tokenError("invalid_request", "refresh_token is required");
    }

    const result = await rotateRefreshToken(refreshToken, client.id);
    if (!result.ok) {
      return tokenError("invalid_grant", "Refresh token is invalid, expired, or revoked");
    }
    return tokenSuccess(result.tokens);
  }

  return tokenError(
    "unsupported_grant_type",
    "grant_type must be authorization_code or refresh_token",
  );
}

export function OPTIONS(): Response {
  return oauthPreflight();
}
