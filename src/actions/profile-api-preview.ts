"use server";

import { z } from "zod";
import { requireAdmin } from "@/lib/auth-helpers";

// Reuse the shared schemas
import { apiPreviewSchema } from "@/lib/validators";

export type ApiPreviewResponse = {
  status: number;
  statusText: string;
  responseTimeMs: number;
  body: unknown;
};

type ActionResult =
  | { success: true; data: ApiPreviewResponse }
  | { success: false; error: string };

export async function previewProfileApi(
  input: z.infer<typeof apiPreviewSchema>
): Promise<ActionResult> {
  // 1. Auth check - admin only
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  // 2. Check PROFILE_API_SECRET is configured
  const secret = process.env.PROFILE_API_SECRET;
  if (!secret) return { success: false, error: "PROFILE_API_SECRET is not configured" };

  // 3. Validate input
  const parsed = apiPreviewSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // 4. Construct URL using established base URL pattern from src/lib/invite.ts
  const baseUrl = process.env.NEXTAUTH_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  const url = new URL("/api/profile", baseUrl);
  url.searchParams.set("email", parsed.data.email);
  if (parsed.data.month) {
    url.searchParams.set("month", parsed.data.month);
  }

  // 5. Call real API with Bearer token, measuring response time
  try {
    const start = performance.now();
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    const elapsed = performance.now() - start;

    const body = await response.json();

    return {
      success: true,
      data: {
        status: response.status,
        statusText: response.statusText,
        responseTimeMs: Math.round(elapsed),
        body,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to reach profile API",
    };
  }
}
