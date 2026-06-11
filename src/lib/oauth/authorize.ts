/**
 * Validation for /oauth/authorize requests (038-mcp-v2).
 *
 * Outcome semantics follow RFC 6749 §4.1.2.1: when the client identity or the
 * redirect URI cannot be trusted the user agent must NOT be redirected
 * (`fatal`), otherwise errors are delivered to the client via redirect with
 * `error=` query params. Shared by the page (GET render) and the consent
 * server actions, which re-validate everything because form fields are
 * client-controlled.
 */

import type { mcpOauthClients } from "@/lib/db/schema";

import { getClientByPublicId } from "@/lib/oauth/store";
import {
  isValidScopeRequest,
  redirectUriMatches,
  MCP_SCOPE,
} from "@/lib/oauth/validate";

/**
 * The OAuth authorize request parameters the Hub understands. The page reads
 * them from searchParams and round-trips them through hidden form fields to
 * the consent server actions — both sides iterate this list.
 */
export const AUTHORIZE_PARAM_KEYS = [
  "client_id",
  "redirect_uri",
  "response_type",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "state",
] as const;

export type AuthorizeParams = Partial<
  Record<(typeof AUTHORIZE_PARAM_KEYS)[number], string>
>;

/** Build AuthorizeParams by reading each known key through `read`. */
export function readAuthorizeParams(
  read: (key: (typeof AUTHORIZE_PARAM_KEYS)[number]) => string | undefined,
): AuthorizeParams {
  const params: AuthorizeParams = {};
  for (const key of AUTHORIZE_PARAM_KEYS) {
    const value = read(key);
    if (value !== undefined) params[key] = value;
  }
  return params;
}

export type AuthorizeValidation =
  | {
      ok: true;
      client: typeof mcpOauthClients.$inferSelect;
      redirectUri: string;
      codeChallenge: string;
      grantedScope: string;
      state: string | null;
    }
  | { ok: false; fatal: true; message: string }
  | { ok: false; fatal: false; redirectTo: string };

/** Append OAuth response params to a redirect URI, preserving its own query. */
export function buildRedirect(
  redirectUri: string,
  params: Record<string, string | null>,
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function validateAuthorizeRequest(
  params: AuthorizeParams,
): Promise<AuthorizeValidation> {
  const state = params.state ?? null;

  if (!params.client_id) {
    return { ok: false, fatal: true, message: "Missing client_id" };
  }
  const client = await getClientByPublicId(params.client_id);
  if (!client) {
    return { ok: false, fatal: true, message: "Unknown client" };
  }

  if (!params.redirect_uri) {
    return { ok: false, fatal: true, message: "Missing redirect_uri" };
  }
  const redirectUri = params.redirect_uri;
  const registered = client.redirectUris.some((uri) =>
    redirectUriMatches(uri, redirectUri),
  );
  if (!registered) {
    return {
      ok: false,
      fatal: true,
      message: "redirect_uri is not registered for this client",
    };
  }

  // From here on the redirect URI is trusted — deliver errors to the client.
  const fail = (error: string, description: string): AuthorizeValidation => ({
    ok: false,
    fatal: false,
    redirectTo: buildRedirect(redirectUri, {
      error,
      error_description: description,
      state,
    }),
  });

  if (params.response_type !== "code") {
    return fail("unsupported_response_type", "Only response_type=code is supported");
  }

  if (!params.code_challenge) {
    return fail("invalid_request", "PKCE code_challenge is required");
  }
  if ((params.code_challenge_method ?? "plain") !== "S256") {
    return fail("invalid_request", "Only code_challenge_method=S256 is supported");
  }

  if (!isValidScopeRequest(params.scope)) {
    return fail("invalid_scope", "Unknown scope requested");
  }

  return {
    ok: true,
    client,
    redirectUri,
    codeChallenge: params.code_challenge,
    grantedScope: MCP_SCOPE,
    state,
  };
}
