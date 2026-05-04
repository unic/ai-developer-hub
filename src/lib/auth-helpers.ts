import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { env } from "@/lib/env";

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
 * environment variable. Returns an error response if unauthorized / the route
 * is misconfigured, or null if authenticated.
 *
 * - 500 when the expected secret env var is unset → operators can distinguish
 *   "server not configured" from "client sent a bad token".
 * - 401 when the token is missing or doesn't match.
 */
export function requireBearerSecret(
  request: NextRequest,
  envVarName: string
): NextResponse | null {
  const expectedToken = process.env[envVarName];

  if (!expectedToken) {
    return NextResponse.json(
      { success: false, error: `Server misconfigured: ${envVarName} is not set` },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${expectedToken}`) {
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

/** Cached system admin user id; null means not yet probed. */
let _systemAdminUserId: number | null = null;

/**
 * Resolves and validates SYSTEM_ADMIN_USER_ID against the live DB.
 *
 * Throws with a descriptive message when:
 * - the env var is missing or empty
 * - the value is not a valid positive integer
 * - no active admin user with that id exists in the DB
 *
 * A successful probe is memoised so the DB is queried at most once per process
 * lifetime. Failures are not cached, allowing recovery without a restart once
 * the env var or DB record is corrected.
 */
export async function getSystemAdminUserId(): Promise<number> {
  if (_systemAdminUserId !== null) return _systemAdminUserId;

  const raw = env.SYSTEM_ADMIN_USER_ID;
  const trimmed = raw?.trim();
  if (!trimmed) {
    throw new Error("SYSTEM_ADMIN_USER_ID is not set or empty");
  }

  // Reject partially-numeric tokens like "7abc"/"7.5"/"1e3" that Number.parseInt would silently accept.
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(
      `SYSTEM_ADMIN_USER_ID="${raw}" is not a valid positive integer`
    );
  }

  const parsed = Number(trimmed);

  const user = await db.query.users.findFirst({
    where: and(
      eq(users.id, parsed),
      eq(users.role, "admin"),
      eq(users.status, "active")
    ),
    columns: { id: true },
  });

  if (!user) {
    throw new Error(
      `SYSTEM_ADMIN_USER_ID=${parsed}: no active admin user with this id exists`
    );
  }

  _systemAdminUserId = user.id;
  return user.id;
}
