import { encode } from "next-auth/jwt";
import type { UserPreferences } from "@/types";
import { env } from "@/lib/env";

/**
 * Built-in deny-list for the nighthawk agent session. Each entry is either a
 * bare path prefix (matches any method) or `METHOD path` (matches that method
 * only). Outbound side effects (real emails, real R2 uploads, key rotations)
 * and destructive admin operations belong here. Read-only admin pages do not.
 *
 * Note: `/api/sync` and `/api/invoices/ingest` are excluded from the
 * middleware matcher (they use their own bearer auth — CRON_SECRET and
 * INVOICE_INGEST_SECRET respectively — not session cookies). The entries
 * below are defense-in-depth: they activate only if the matcher is later
 * widened to cover those paths. Day-to-day, route-level bearer auth is what
 * keeps an agent session out of those endpoints.
 */
export const BUILT_IN_DENY_PATHS: readonly string[] = [
  "DELETE /api/users",
  "POST /api/users/invite",
  "POST /api/users/reset-password",
  "/api/invoices/ingest",
  "/api/sync",
  "/api/mcp",
  "/setup-password",
  "POST /api/anthropic-config",
  "POST /api/github-config",
];

function parseDenyEntry(entry: string): {
  method: string | null;
  path: string;
} {
  const trimmed = entry.trim();
  if (!trimmed) return { method: null, path: "" };
  const space = trimmed.indexOf(" ");
  if (space === -1) return { method: null, path: trimmed };
  const method = trimmed.slice(0, space).toUpperCase();
  const path = trimmed.slice(space + 1).trim();
  return { method, path };
}

/**
 * Returns true if the agent must be refused for the given path/method based on
 * BUILT_IN_DENY_PATHS plus the optional comma-separated AGENT_DENY_PATHS env
 * var. Matching is by prefix; any entry that prefixes the request path counts.
 */
export function isAgentDenied(pathname: string, method: string): boolean {
  const upper = method.toUpperCase();
  const extras = (env.AGENT_DENY_PATHS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const raw of [...BUILT_IN_DENY_PATHS, ...extras]) {
    const { method: entryMethod, path } = parseDenyEntry(raw);
    if (!path) continue;
    if (entryMethod && entryMethod !== upper) continue;
    if (
      pathname === path ||
      pathname.startsWith(path.endsWith("/") ? path : path + "/")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Returns the cookie name Auth.js uses for the session JWT. Picks the
 * `__Secure-` prefix when the deployment URL is HTTPS, matching Auth.js's
 * `useSecureCookies` default. Reads AUTH_URL first (Auth.js v5 convention)
 * then falls back to NEXTAUTH_URL (set explicitly in src/lib/auth.ts on
 * Vercel preview deploys).
 */
export function getSessionCookieName(): string {
  const url = env.AUTH_URL || env.NEXTAUTH_URL || "";
  const isHttps = url.startsWith("https://");
  return isHttps ? "__Secure-authjs.session-token" : "authjs.session-token";
}

export interface AgentJwtPayload {
  id: string;
  email: string;
  name: string;
  role: string;
  preferences: UserPreferences;
  isAgent: true;
}

/**
 * Mints a NextAuth-compatible session JWT for the agent user. The payload
 * mirrors what the jwt callback in src/lib/auth.ts would produce on a normal
 * login, so downstream Auth.js decode treats this token identically to a real
 * one. The cookie name (used as the JWE salt) must match what Auth.js looks
 * for at runtime — getSessionCookieName() handles HTTPS vs HTTP.
 */
export async function mintAgentJwt(
  payload: AgentJwtPayload,
  options: { maxAgeSeconds?: number } = {},
): Promise<{ cookieName: string; token: string; maxAgeSeconds: number }> {
  const secret = env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set");
  }
  const cookieName = getSessionCookieName();
  const maxAgeSeconds = options.maxAgeSeconds ?? 30 * 60;
  const token = await encode({
    token: payload,
    secret,
    salt: cookieName,
    maxAge: maxAgeSeconds,
  });
  return { cookieName, token, maxAgeSeconds };
}
