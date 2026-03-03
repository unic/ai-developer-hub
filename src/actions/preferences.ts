"use server";

import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { userPreferencesSchema } from "@/lib/validators";
import type { ActionResult, UserPreferences } from "@/types";

export async function updatePreferences(
  input: unknown
): Promise<ActionResult<UserPreferences>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized" };
  }

  const parsed = userPreferencesSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (!fieldErrors[key]) fieldErrors[key] = [];
      fieldErrors[key].push(issue.message);
    }
    return { success: false, error: "Validation failed", fieldErrors };
  }

  try {
    await db
      .update(users)
      .set({
        preferences: parsed.data,
        updatedAt: new Date(),
      })
      .where(eq(users.id, Number(session.user.id)));

    return { success: true, data: parsed.data };
  } catch {
    return { success: false, error: "Failed to save preferences" };
  }
}
