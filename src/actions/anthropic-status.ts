"use server";

import { requireAdmin } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { anthropicWorkspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";

type AnthropicStatusData = {
  connected: boolean;
  workspaceName: string | null;
  lastCheckedAt: string;
};

type AnthropicStatusResult =
  | { success: true; data: AnthropicStatusData }
  | { success: false; error: string };

export async function checkAnthropicStatus(): Promise<AnthropicStatusResult> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const lastCheckedAt = new Date().toISOString();
  const apiKey = env.ANTHROPIC_ADMIN_API_KEY;

  if (!apiKey) {
    return {
      success: true,
      data: { connected: false, workspaceName: null, lastCheckedAt },
    };
  }

  try {
    const response = await fetch(
      "https://api.anthropic.com/v1/organizations/workspaces?limit=1",
      {
        method: "GET",
        cache: "no-store",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": env.ANTHROPIC_API_VERSION ?? "2023-06-01",
        },
      }
    );

    if (!response.ok) {
      return {
        success: true,
        data: { connected: false, workspaceName: null, lastCheckedAt },
      };
    }

    // API call succeeded — connection is valid
    const defaultWorkspace = await db.query.anthropicWorkspaces.findFirst({
      where: eq(anthropicWorkspaces.isDefault, true),
      columns: { name: true },
    });

    return {
      success: true,
      data: {
        connected: true,
        workspaceName: defaultWorkspace?.name ?? null,
        lastCheckedAt,
      },
    };
  } catch (err) {
    console.error("Anthropic status check failed:", err instanceof Error ? err.message : String(err));
    return {
      success: true,
      data: {
        connected: false,
        workspaceName: null,
        lastCheckedAt,
      },
    };
  }
}
