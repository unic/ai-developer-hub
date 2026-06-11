export const PUBLIC_PATHS = ["/login", "/setup-password"];

export const MUST_CHANGE_PASSWORD_ERROR = "MUST_CHANGE_PASSWORD";

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

/**
 * Paths rendered without the app sidebar shell. Superset of the public paths:
 * the OAuth consent screen requires a session but is shown to users arriving
 * from an external client, so the app chrome would be noise (038-mcp-v2).
 */
const BARE_LAYOUT_PATHS = ["/oauth/authorize"];

export function isBareLayoutPath(pathname: string): boolean {
  return (
    isPublicPath(pathname) ||
    BARE_LAYOUT_PATHS.some(
      (p) => pathname === p || pathname.startsWith(p + "/")
    )
  );
}
