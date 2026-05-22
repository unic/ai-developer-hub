// Outbound POST to a Microsoft Teams Workflows incoming webhook.
//
// Honors Retry-After on 429, retries on 412/502/504 per Microsoft's bot rate-limit
// guidance. NEVER logs the webhook URL — the URL is the auth (HMAC-signed Logic
// Apps trigger). On unrecoverable failure, the error message is sanitized.

import "server-only";

import type { CardEnvelope } from "./types";

const RETRIABLE_STATUSES = new Set([412, 429, 502, 504]);
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 20_000;
const JITTER_PCT = 0.2;

class TeamsWebhookError extends Error {
  constructor(message: string, public readonly retriable: boolean, public readonly retryAfterMs?: number) {
    super(message);
    this.name = "TeamsWebhookError";
  }
}

/**
 * POST one Adaptive Card envelope to a Workflows webhook URL.
 * Caller MUST pass the URL (do not read env here — keeps the function testable).
 */
export async function postCard(webhookUrl: string, envelope: CardEnvelope): Promise<void> {
  let lastError: TeamsWebhookError | Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope),
      });

      if (res.ok) return;

      if (RETRIABLE_STATUSES.has(res.status)) {
        const retryAfterHeader = res.headers.get("retry-after");
        const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
        lastError = new TeamsWebhookError(
          `Teams webhook returned ${res.status}`,
          true,
          retryAfterMs && Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
        );
      } else {
        // Non-retriable. Do NOT include the response body in the error — Logic
        // Apps sometimes echoes back parts of the request URL, which is auth.
        throw new TeamsWebhookError(`Teams webhook returned ${res.status}`, false);
      }
    } catch (err) {
      if (err instanceof TeamsWebhookError && !err.retriable) {
        throw err;
      }
      lastError =
        err instanceof TeamsWebhookError
          ? err
          : new TeamsWebhookError(`Teams webhook network error`, true);
    }

    if (attempt === MAX_ATTEMPTS) break;

    const explicit =
      lastError instanceof TeamsWebhookError ? lastError.retryAfterMs : undefined;
    const backoff = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
    const jitter = Math.floor((Math.random() * 2 - 1) * JITTER_PCT * backoff);
    const delay = Math.max(0, explicit ?? backoff + jitter);
    await new Promise((r) => setTimeout(r, delay));
  }

  // Re-throw the final error.
  throw lastError ?? new Error("Teams webhook failed (unknown)");
}
