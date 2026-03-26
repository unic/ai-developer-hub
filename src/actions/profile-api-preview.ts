"use server";

import { z } from "zod";
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth-helpers";
import { apiPreviewSchema } from "@/lib/validators";
import { GET } from "@/app/api/profile/route";

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

  const secret = process.env.PROFILE_API_SECRET;
  if (!secret) return { success: false, error: "API not configured" };

  const parsed = apiPreviewSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const url = new URL("http://localhost/api/profile");
  url.searchParams.set("email", parsed.data.email);
  if (parsed.data.month) {
    url.searchParams.set("month", parsed.data.month);
  }

  const request = new NextRequest(url, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  try {
    const start = performance.now();
    const response = await GET(request);
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
      error: err instanceof Error ? err.message : "Failed to call profile API",
    };
  }
}
