import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * Require the current session user to be an admin.
 * Returns the user object if admin, or null otherwise.
 */
export async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") return null;
  return session.user;
}

/**
 * Validate a Bearer token from the Authorization header against a named
 * environment variable. Returns an error response if unauthorized, or null
 * if authenticated. Fails closed when the env var is not set.
 */
export function requireBearerSecret(
  request: NextRequest,
  envVarName: string
): NextResponse | null {
  const authHeader = request.headers.get("authorization");
  const expectedToken = process.env[envVarName];

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  return null;
}

/**
 * Validate CRON_SECRET Bearer token for Vercel Cron Job routes.
 * Returns an error response if unauthorized, or null if authenticated.
 */
export function requireCronSecret(request: NextRequest): NextResponse | null {
  return requireBearerSecret(request, "CRON_SECRET");
}
