import { z } from "zod";

export const orgApiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  partial_key_hint: z.string(),
  status: z.string(),
  type: z.string(),
});

export const orgApiKeysResponseSchema = z.object({
  data: z.array(orgApiKeySchema),
  has_more: z.boolean(),
});

export type OrgApiKey = z.infer<typeof orgApiKeySchema>;

export async function fetchOrgApiKeys(): Promise<OrgApiKey[]> {
  const adminKey = process.env.ANTHROPIC_ADMIN_API_KEY;
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
      "anthropic-version": "2023-06-01",
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
    const suffix = orgKey.partial_key_hint.replace(/^[.\u2026]+/, "");
    if (suffix && decryptedKey.endsWith(suffix)) {
      return orgKey.id;
    }
  }
  return null;
}
