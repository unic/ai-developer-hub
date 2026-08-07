/**
 * Plan tokens for destructive MCP write tools (043-mcp-write-tools).
 *
 * `confirm: boolean` is not a guardrail against an LLM — the model satisfies it
 * in the same turn it invents the call. A plan token is issued alongside a
 * preview and signed over the resolved plan, so a commit is impossible without a
 * preceding preview, and impossible if the underlying state moved.
 *
 * What it proves and what it does NOT: it proves the caller read the resolved
 * state. It does NOT prove a human saw the preview — in an auto-approving client
 * the preview and the commit are consecutive tool calls with no human turn
 * between them. `destructiveHint: true` is the mechanism that asks the human.
 */

import { createHmac, hkdfSync } from "node:crypto";

import { env } from "@/lib/env";
import { safeEqual } from "@/lib/oauth/validate";

/** Tokens older than this are refused, so one cannot be replayed much later. */
export const PLAN_TOKEN_TTL_SECONDS = 10 * 60;

const HKDF_INFO = "mcp-plan-token-v1";

/**
 * Derive a dedicated signing key instead of using AUTH_SECRET directly, so this
 * new signing surface can never become an oracle on the session-cookie key.
 */
function signingKey(): Buffer {
  const secret = env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return Buffer.from(
    hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), HKDF_INFO, 32),
  );
}

export interface PlanTokenSubject {
  /** OAuth client public id — part of the caller binding. */
  clientId: string;
  /** Hub user id the token is bound to. */
  userId: number;
}

/**
 * Deterministic serialization of the plan. Key order must not affect the
 * signature, so keys are sorted recursively.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`)
    .join(",")}}`;
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

/**
 * Issue a token for `plan`, bound to the tool, the caller, and the issue time.
 * `plan` must include every piece of mutable state the commit depends on (for a
 * reprice: the tier id and the price it was planned against) and nothing that
 * moves harmlessly (not the affected-row id set — a benign concurrent assignment
 * must not force a pointless re-preview).
 */
export function issuePlanToken(
  tool: string,
  plan: unknown,
  subject: PlanTokenSubject,
  nowSeconds: number,
): string {
  const iat = Math.floor(nowSeconds);
  const body = canonicalize({
    tool,
    plan,
    sub: `${subject.clientId}:${subject.userId}`,
    iat,
  });
  return `${iat}.${sign(body)}`;
}

export type PlanTokenVerdict =
  | { ok: true }
  | { ok: false; reason: "malformed" | "expired" | "mismatch" };

/**
 * Verify a token against the plan the commit call resolved. Any disagreement —
 * tampering, a different caller, a moved price, an expired token — fails.
 */
export function verifyPlanToken(
  token: string,
  tool: string,
  plan: unknown,
  subject: PlanTokenSubject,
  nowSeconds: number,
): PlanTokenVerdict {
  const dot = token.indexOf(".");
  if (dot <= 0) return { ok: false, reason: "malformed" };

  const iatRaw = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!/^\d{1,15}$/.test(iatRaw) || mac.length === 0) {
    return { ok: false, reason: "malformed" };
  }
  const iat = Number(iatRaw);

  const body = canonicalize({
    tool,
    plan,
    sub: `${subject.clientId}:${subject.userId}`,
    iat,
  });
  // Signature first: a mismatched plan must not be distinguishable from an
  // expired one by timing, and an attacker must not learn the TTL boundary.
  if (!safeEqual(mac, sign(body))) return { ok: false, reason: "mismatch" };

  const age = Math.floor(nowSeconds) - iat;
  if (age < 0 || age > PLAN_TOKEN_TTL_SECONDS) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}

/**
 * The refusal text. Never echoes the expected token — the whole point is that it
 * cannot be constructed — and always names the exact recovery so an agent
 * redirects instead of retrying with a guess.
 */
export function planTokenErrorMessage(
  reason: "missing" | "malformed" | "expired" | "mismatch",
): string {
  const retry =
    "Call this tool again WITHOUT planToken to get a fresh preview and token.";
  switch (reason) {
    case "missing":
      return `This tool requires a planToken to commit. ${retry}`;
    case "expired":
      return `That planToken has expired (valid for ${
        PLAN_TOKEN_TTL_SECONDS / 60
      } minutes). ${retry}`;
    case "mismatch":
      return (
        "That planToken does not match this request — either the arguments " +
        `changed, the underlying data moved, or it was issued to another session. ${retry}`
      );
    case "malformed":
      return `That planToken is not a valid token. ${retry}`;
  }
}
