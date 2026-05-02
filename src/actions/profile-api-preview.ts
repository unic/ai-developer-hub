"use server";

import { z } from "zod";
import { requireAdmin } from "@/lib/auth-helpers";
import { apiPreviewSchema } from "@/lib/validators";
import { env } from "@/lib/env";

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
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const secret = env.PROFILE_API_SECRET;
  if (!secret) return { success: false, error: "API not configured" };

  const parsed = apiPreviewSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const baseUrl = env.NEXTAUTH_URL
    || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : "http://localhost:3000");

  const url = new URL("/api/profile", baseUrl);
  url.searchParams.set("email", parsed.data.email);
  if (parsed.data.month) {
    url.searchParams.set("month", parsed.data.month);
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
  };
  const bypassSecret = env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypassSecret) {
    headers["x-vercel-protection-bypass"] = bypassSecret;
  }

  try {
    const start = performance.now();
    const response = await fetch(url.toString(), {
      headers,
      cache: "no-store",
    });
    const elapsed = performance.now() - start;

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = { error: `Non-JSON response (${response.status})` };
    }

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
