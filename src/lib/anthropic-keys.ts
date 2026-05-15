import { z } from "zod";
import { ANTHROPIC_API_VERSION } from "@/lib/anthropic-constants";
import { env } from "@/lib/env";

export const orgApiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  partial_key_hint: z.string(),
  status: z.string(),
  type: z.string(),
  // Anthropic returns null for keys in the org's default workspace; that
  // null is meaningful and must be preserved as null (not coerced to a string).
  workspace_id: z.string().nullable().optional().default(null),
});

export const orgApiKeysResponseSchema = z.object({
  data: z.array(orgApiKeySchema),
  has_more: z.boolean(),
});

export type OrgApiKey = z.infer<typeof orgApiKeySchema>;

export async function fetchOrgApiKeys(): Promise<OrgApiKey[]> {
  const adminKey = env.ANTHROPIC_ADMIN_API_KEY;
  if (!adminKey) {
    throw new Error(
      "ANTHROPIC_ADMIN_API_KEY environment variable is not set"
    );
  }

  const url =
    "https://api.anthropic.com/v1/organizations/api_keys?status=active&limit=100";

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "x-api-key": adminKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch org API keys: ${response.status} ${response.statusText}`
    );
  }

  const json: unknown = await response.json();
  const parsed = orgApiKeysResponseSchema.parse(json);

  if (parsed.has_more) {
    console.warn(
      "Warning: more than 100 active API keys exist. Pagination not yet implemented — some keys may be missing."
    );
  }

  return parsed.data;
}

export function resolveApiKeyId(
  decryptedKey: string,
  orgKeys: OrgApiKey[]
): string | null {
  for (const orgKey of orgKeys) {
    const hint = orgKey.partial_key_hint;

    // Extract suffix after the last ellipsis pattern (e.g. "sk-ant-...xyzw" → "xyzw")
    const ellipsisPatterns = ["...", "\u2026"];
    let suffix = hint;
    for (const pat of ellipsisPatterns) {
      const idx = hint.lastIndexOf(pat);
      if (idx !== -1) {
        suffix = hint.slice(idx + pat.length);
        break;
      }
    }
    // Also strip any remaining leading dots
    suffix = suffix.replace(/^\.+/, "");

    if (suffix && decryptedKey.endsWith(suffix)) {
      return orgKey.id;
    }
  }
  return null;
}
