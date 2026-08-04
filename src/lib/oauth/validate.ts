/**
 * Pure validation helpers for the embedded OAuth 2.1 authorization server
 * (038-mcp-v2). No I/O — fully unit testable.
 *
 * Policy summary:
 * - Public clients only (PKCE S256 mandatory, no client secrets).
 * - Redirect URIs must be https, or http on a loopback host (RFC 8252 §7.3).
 *   Loopback matching ignores the port because Claude Code redirects to an
 *   ephemeral localhost port chosen at authorize time.
 * - Two scopes: `mcp:read` (spec 034) and `mcp:write` (043-mcp-write-tools).
 *   `mcp:write` is granted only when the client asks for it AND the consenting
 *   session user is an admin, so a grant can never carry more authority than the
 *   consent screen described.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const MCP_SCOPE = "mcp:read";

/**
 * Write capability over MCP (043). Separate from the admin role on purpose:
 * every grant issued before this feature was consented to with the words "No
 * write access." on the screen, so those tokens must stay read-only until the
 * human re-authorizes. The role is still checked independently at call time.
 */
export const MCP_WRITE_SCOPE = "mcp:write";

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

/** RFC 7591 client metadata — only the fields the Hub stores or echoes. */
export const clientRegistrationSchema = z.object({
  client_name: z.string().trim().min(1).max(255).optional(),
  redirect_uris: z
    .array(z.string().min(1).max(2000))
    .min(1, "redirect_uris must contain at least one URI")
    .max(10, "too many redirect_uris"),
});

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

/**
 * A redirect URI is registrable when it is https, or http pointing at a
 * loopback host (native-app pattern). Fragments are forbidden (RFC 6749 §3.1.2)
 * and custom URI schemes are not accepted — Claude's clients use the hosted
 * https callback or a loopback http URL.
 */
export function isAllowedRedirectUri(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.hostname === "") return false;
  if (parsed.hash !== "") return false;
  if (parsed.username !== "" || parsed.password !== "") return false;
  if (parsed.protocol === "https:") return true;
  if (parsed.protocol === "http:") return isLoopbackHost(parsed.hostname);
  return false;
}

/**
 * Exact-match a presented redirect URI against a registered one, with the
 * single RFC 8252 §7.3 relaxation: for http loopback URIs the port component
 * is ignored (Claude Code binds a random ephemeral port per authorization).
 */
export function redirectUriMatches(
  registered: string,
  presented: string,
): boolean {
  if (registered === presented) return true;

  let a: URL;
  let b: URL;
  try {
    a = new URL(registered);
    b = new URL(presented);
  } catch {
    return false;
  }

  return (
    a.protocol === "http:" &&
    b.protocol === "http:" &&
    isLoopbackHost(a.hostname) &&
    a.hostname === b.hostname &&
    a.pathname === b.pathname &&
    a.search === b.search &&
    b.hash === "" &&
    b.username === "" &&
    b.password === ""
  );
}

/** base64url(sha256(verifier)) — the S256 transform from RFC 7636 §4.2. */
export function pkceChallengeFromVerifier(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/**
 * Verify a PKCE code_verifier against the stored S256 challenge.
 * Enforces the RFC 7636 §4.1 verifier alphabet/length before hashing.
 */
export function verifyPkce(verifier: string, storedChallenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return safeEqual(pkceChallengeFromVerifier(verifier), storedChallenge);
}

/**
 * Is the requested scope string (space-delimited) acceptable? Empty/absent is
 * fine — MCP_SCOPE is always granted. Unknown scopes are rejected so the consent
 * screen never overstates what it grants. `offline_access` is tolerated and
 * ignored (some clients request it reflexively; refresh tokens are always
 * issued).
 */
export function isValidScopeRequest(scope: string | undefined | null): boolean {
  if (!scope || scope.trim() === "") return true;
  const known = new Set([MCP_SCOPE, MCP_WRITE_SCOPE, "offline_access"]);
  return scope
    .trim()
    .split(/\s+/)
    .every((s) => known.has(s));
}

/** Did the client ask for write capability? */
export function requestsWriteScope(scope: string | undefined | null): boolean {
  if (!scope) return false;
  return scope.trim().split(/\s+/).includes(MCP_WRITE_SCOPE);
}

/**
 * Resolve what a grant actually receives. `mcp:read` is unconditional;
 * `mcp:write` requires BOTH an explicit request and an admin consenter — a
 * viewer who somehow reaches a write-scoped authorize URL gets a read-only grant
 * rather than an error, which keeps the connector usable.
 */
export function resolveGrantedScope(
  requestedScope: string | undefined | null,
  consenterRole: string | undefined,
): string {
  if (requestsWriteScope(requestedScope) && consenterRole === "admin") {
    return `${MCP_SCOPE} ${MCP_WRITE_SCOPE}`;
  }
  return MCP_SCOPE;
}

/** Does a stored/space-delimited grant carry write capability? */
export function hasWriteScope(scopes: readonly string[] | undefined): boolean {
  return scopes?.includes(MCP_WRITE_SCOPE) ?? false;
}
