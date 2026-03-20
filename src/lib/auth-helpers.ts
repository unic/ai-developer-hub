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
 * Validate CRON_SECRET Bearer token for Vercel Cron Job routes.
 * Returns an error response if unauthorized, or null if authenticated.
 */
export function requireCronSecret(request: NextRequest): NextResponse | null {
  const authHeader = request.headers.get("authorization");
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  return null;
}
