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
