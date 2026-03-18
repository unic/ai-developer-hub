export const PUBLIC_PATHS = ["/login", "/setup-password"];

export const MUST_CHANGE_PASSWORD_ERROR = "MUST_CHANGE_PASSWORD";

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}
