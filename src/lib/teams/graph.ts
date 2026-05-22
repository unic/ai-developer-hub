// Microsoft Graph posts for license-request workflow (spec 032-automation-workflow).
//
// Mirrors the conventions of webhook.ts:
//   - retry/backoff with jitter on 412/429/502/504, max 3 attempts, Retry-After honored
//   - throws a custom error class with a `retriable` boolean
//   - pure-ish: caller passes inputs, no side effects beyond the HTTP call
//   - never logs the access token or client secret
//
// The two public functions cover everything the Hub posts to Teams:
//   - postChannelReply: adaptive card / message body posted as a reply to a
//     specific channel message (the PA-posted initial notice)
//   - postChatMessage: plain message body posted into an existing group chat
//     (the PA-created chat with requester + approvers)

import "server-only";

import { markdownToTeamsHtml } from "./markdown";

export { markdownToTeamsHtml };

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

const RETRIABLE_STATUSES = new Set([412, 429, 502, 504]);
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 20_000;
const JITTER_PCT = 0.2;

export class GraphApiError extends Error {
  constructor(
    message: string,
    public readonly retriable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "GraphApiError";
  }
}

// — Auth — ----------------------------------------------------------------

interface TokenCache {
  accessToken: string;
  /** ms since epoch; we refresh 60s before this */
  expiresAt: number;
}

let cached: TokenCache | null = null;

/**
 * Whether the Graph helper has the env vars it needs to actually talk to Graph.
 * When false, postChannelReply/postChatMessage no-op with a console warning
 * instead of throwing — lets the rest of the workflow function while IT-112678
 * is still in flight.
 */
export function isGraphConfigured(): boolean {
  return Boolean(
    process.env.GRAPH_TENANT_ID &&
      process.env.GRAPH_CLIENT_ID &&
      process.env.GRAPH_CLIENT_SECRET,
  );
}

async function acquireToken(): Promise<string> {
  if (cached && cached.expiresAt - Date.now() > 60_000) {
    return cached.accessToken;
  }
  const tenantId = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new GraphApiError(
      "Graph env vars not set (GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET)",
      false,
    );
  }

  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    // Do not echo the response body — Azure error responses sometimes include
    // request URLs / tenant IDs that aren't sensitive but aren't useful in logs.
    throw new GraphApiError(`Token acquisition failed: ${res.status}`, false, res.status);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  cached = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

// — Retry-aware POST — ---------------------------------------------------

async function graphPost(path: string, body: unknown): Promise<unknown> {
  if (!isGraphConfigured()) {
    // Documented escape hatch: skip the call rather than throw. Lets the rest
    // of the workflow function during local dev / before IT issues credentials.
    console.warn(
      `[graph] skipping POST ${path} — Graph env vars not set (IT-112678 pending)`,
    );
    return null;
  }

  let lastError: GraphApiError | Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let token: string;
    try {
      token = await acquireToken();
    } catch (err) {
      // Token failure is not retriable (likely misconfigured env or revoked secret).
      throw err instanceof GraphApiError
        ? err
        : new GraphApiError("Token acquisition error", false);
    }

    try {
      const res = await fetch(`${GRAPH_BASE}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        try {
          return await res.json();
        } catch {
          return null;
        }
      }

      if (RETRIABLE_STATUSES.has(res.status)) {
        const retryAfterHeader = res.headers.get("retry-after");
        const retryAfterMs = retryAfterHeader
          ? Number(retryAfterHeader) * 1000
          : undefined;
        lastError = new GraphApiError(
          `Graph POST ${path} returned ${res.status}`,
          true,
          res.status,
        );
        // Encode retry-after via attempt-loop sleep below
        if (retryAfterMs && Number.isFinite(retryAfterMs)) {
          await new Promise((r) => setTimeout(r, retryAfterMs));
          continue;
        }
      } else {
        // 401 specifically: token may have been invalidated mid-flight; invalidate
        // cache and let the next attempt re-acquire. Still non-retriable for the
        // outer loop on this attempt — we don't recursively retry within one call.
        if (res.status === 401) cached = null;
        throw new GraphApiError(
          `Graph POST ${path} returned ${res.status}`,
          false,
          res.status,
        );
      }
    } catch (err) {
      if (err instanceof GraphApiError && !err.retriable) throw err;
      lastError =
        err instanceof GraphApiError
          ? err
          : new GraphApiError(`Graph network error`, true);
    }

    if (attempt === MAX_ATTEMPTS) break;
    const backoff = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
    const jitter = Math.floor((Math.random() * 2 - 1) * JITTER_PCT * backoff);
    await new Promise((r) => setTimeout(r, Math.max(0, backoff + jitter)));
  }

  throw lastError ?? new GraphApiError("Graph POST failed (unknown)", true);
}

// — Public surface — -----------------------------------------------------

export interface ChannelReplyInput {
  teamId: string;
  channelId: string;
  parentMessageId: string;
  bodyMarkdown: string;
}

export interface ChatMessageInput {
  chatId: string;
  bodyMarkdown: string;
}

/**
 * Post a reply to a specific channel message. Requires Microsoft Graph
 * application permission `ChannelMessage.Send` (admin-consented).
 */
export async function postChannelReply(input: ChannelReplyInput): Promise<void> {
  const { teamId, channelId, parentMessageId, bodyMarkdown } = input;
  await graphPost(
    `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(parentMessageId)}/replies`,
    {
      body: {
        contentType: "html",
        content: markdownToTeamsHtml(bodyMarkdown),
      },
    },
  );
}

/**
 * Post a message into an existing chat (in this workflow, the group chat
 * PA creates between requester + approvers). Requires Microsoft Graph
 * application permission `ChatMessage.Send` (admin-consented).
 */
export async function postChatMessage(input: ChatMessageInput): Promise<void> {
  const { chatId, bodyMarkdown } = input;
  await graphPost(`/chats/${encodeURIComponent(chatId)}/messages`, {
    body: {
      contentType: "html",
      content: markdownToTeamsHtml(bodyMarkdown),
    },
  });
}

/**
 * Adaptive card posted as the initial channel reply on ingest. Renders a
 * compact request summary + a single "Review in Hub" button.
 */
export async function postLicenseRequestCard(input: {
  teamId: string;
  channelId: string;
  parentMessageId: string;
  requestId: number;
  requesterName: string;
  toolName: string;
  tierName: string | null;
  hubUrl: string;
}): Promise<void> {
  const card = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    body: [
      {
        type: "TextBlock",
        text: `License request REQ-${input.requestId}`,
        weight: "Bolder",
        size: "Medium",
      },
      {
        type: "FactSet",
        facts: [
          { title: "Requester", value: input.requesterName },
          { title: "Tool", value: input.toolName },
          { title: "Tier", value: input.tierName ?? "—" },
        ],
      },
    ],
    actions: [
      {
        type: "Action.OpenUrl",
        title: "Review in Hub",
        url: input.hubUrl,
      },
    ],
  };

  await graphPost(
    `/teams/${encodeURIComponent(input.teamId)}/channels/${encodeURIComponent(input.channelId)}/messages/${encodeURIComponent(input.parentMessageId)}/replies`,
    {
      body: {
        contentType: "html",
        content: "A new license request needs review.",
      },
      attachments: [
        {
          id: `card-${input.requestId}`,
          contentType: "application/vnd.microsoft.card.adaptive",
          content: JSON.stringify(card),
        },
      ],
    },
  );
}
