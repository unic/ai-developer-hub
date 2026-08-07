/**
 * Role-based authorization for MCP tools (039-mcp-role-scoping).
 *
 * Pure module — no I/O, no DB — mirroring the `format.ts` testability
 * philosophy. The role arrives in `AuthInfo.extra` from `verifyMcpToken`:
 * OAuth tokens carry the live `users.role` (re-read on every request), the
 * shared secret asserts `role: "admin"` explicitly. Anything that is not
 * literally `"admin"` is treated as viewer — least privilege; admin access
 * only ever follows an explicit assertion, never a fallback.
 */

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import {
  errorResult,
  safeJsonResult,
  type McpToolResult,
} from "@/lib/mcp/format";
import { hasWriteScope } from "@/lib/oauth/validate";

export type McpRole = "admin" | "viewer";

/** The caller context a tool handler authorizes against. */
export interface McpCaller {
  role: McpRole;
  /** Absent for the shared-secret credential (no bound user). */
  userId?: number;
  /** Absent for the shared-secret credential (no bound user). */
  email?: string;
}

/**
 * One consistent denial across all admin-only tools so assistants can relay
 * the reason and steer to the tools viewers can use. Contains no org data.
 */
export const ADMIN_REQUIRED_MESSAGE =
  "This tool requires the admin role. Your MCP credential is bound to a viewer account — " +
  "viewers can use get_user_cost_profile and list_license_assignments (scoped to their own data) " +
  "and list_ai_tools.";

/** Refusal when a viewer asks for another user's data — never silently substituted. */
export const SELF_ONLY_MESSAGE =
  "Viewers can only access their own data. Omit the email argument (or pass your own email) " +
  "to query the account bound to this token.";

/** Admin-equivalent credentials without a bound user must name a target explicitly. */
export const EMAIL_REQUIRED_MESSAGE =
  "This credential is not bound to a user, so there is no default identity. " +
  "Pass an explicit email argument.";

/**
 * Translate the transport's AuthInfo into a caller. Missing AuthInfo, missing
 * extra, or an unrecognized role all collapse to viewer with no identity —
 * fail-closed.
 */
export function callerFromAuthInfo(authInfo?: AuthInfo): McpCaller {
  const extra = authInfo?.extra;
  return {
    role: extra?.role === "admin" ? "admin" : "viewer",
    userId: typeof extra?.userId === "number" ? extra.userId : undefined,
    email: typeof extra?.email === "string" ? extra.email : undefined,
  };
}

/** The slice of the SDK's RequestHandlerExtra that tool handlers consume here. */
export interface HandlerAuthExtra {
  authInfo?: AuthInfo;
}

/**
 * Gate a tool's data assembly behind the admin role. Non-admin callers get the
 * shared denial as an `isError` tool result (the MCP session stays healthy and
 * the data function is never invoked); admin callers flow through
 * `safeJsonResult` exactly as before 039.
 */
export function adminOnly<Args>(
  run: (args: Args) => Promise<unknown>,
): (args: Args, extra: HandlerAuthExtra) => Promise<McpToolResult> {
  return (args, extra) => {
    if (callerFromAuthInfo(extra?.authInfo).role !== "admin") {
      return Promise.resolve(errorResult(ADMIN_REQUIRED_MESSAGE));
    }
    return safeJsonResult(() => run(args));
  };
}

// ---- Write authorization (043-mcp-write-tools) ----

export const WRITE_DISABLED_MESSAGE =
  "MCP write tools are disabled on this deployment (MCP_WRITE_ENABLED is not set). " +
  "Make this change in the Hub UI, or ask an operator to enable write access.";

export const WRITE_SCOPE_REQUIRED_MESSAGE =
  "This MCP connection was authorized for read-only access, so it cannot make changes. " +
  "Reconnect the connector and approve the write permission on the consent screen " +
  "(Settings → Connections in the Hub), then retry.";

export const WRITE_NEEDS_BOUND_USER_MESSAGE =
  "This credential is not bound to a Hub user, so a change made with it could not be " +
  "attributed to anyone in the audit trail. Write tools require an OAuth connection " +
  "signed in as an admin; the shared MCP secret is read-only.";

export const AGENT_ACTOR_REFUSED_MESSAGE =
  "This credential belongs to an automation account, which is not permitted to " +
  "create or modify users and licenses. Use an admin's own connection.";

/** A caller that has passed the write gate: admin, write-scoped, and identified. */
export interface McpWriteActor {
  userId: number;
  email?: string;
  clientId: string;
}

export type WriteAuthorization =
  | { ok: true; actor: McpWriteActor }
  | { ok: false; message: string };

/**
 * The single authorization decision for every MCP write tool. Conjunctive with
 * no fallback branch: a disjunction (`role === "admin" || hasScope`) would let a
 * connection consented to as read-only write freely, making the consent screen
 * false in the opposite direction.
 *
 * The kill switch reads `process.env` per request rather than the memoized `env`
 * object (mirroring src/lib/mcp/auth.ts) so flipping it does not require a code
 * change — though on Vercel it still only reaches warm instances as they recycle.
 */
export async function authorizeWrite(
  authInfo: AuthInfo | undefined,
  isAgentUser: (userId: number) => Promise<boolean>,
): Promise<WriteAuthorization> {
  if (process.env.MCP_WRITE_ENABLED !== "1") {
    return { ok: false, message: WRITE_DISABLED_MESSAGE };
  }

  const caller = callerFromAuthInfo(authInfo);
  if (caller.role !== "admin") {
    return { ok: false, message: ADMIN_REQUIRED_MESSAGE };
  }

  // The shared secret's scopes are the hardcoded [MCP_SCOPE] literal, so it fails
  // here with no branch dedicated to it — which is correct: an unbound credential
  // cannot attribute a write.
  if (!hasWriteScope(authInfo?.scopes)) {
    return { ok: false, message: WRITE_SCOPE_REQUIRED_MESSAGE };
  }

  if (typeof caller.userId !== "number") {
    return { ok: false, message: WRITE_NEEDS_BOUND_USER_MESSAGE };
  }

  // Defense in depth: BUILT_IN_DENY_PATHS forbids agent identities from user
  // creation/deletion over HTTP, and MCP is outside the middleware matcher.
  if (await isAgentUser(caller.userId)) {
    return { ok: false, message: AGENT_ACTOR_REFUSED_MESSAGE };
  }

  return {
    ok: true,
    actor: {
      userId: caller.userId,
      email: caller.email,
      clientId: authInfo?.clientId ?? "unknown",
    },
  };
}

export type SelfEmailResolution =
  | { ok: true; email: string }
  | { ok: false; message: string };

/**
 * Pin a personal tool's target identity to the caller. Admin-equivalent
 * callers may target anyone (defaulting to themselves when token-bound);
 * viewers are locked to the email bound to their token — a foreign email is
 * refused, never silently swapped. Comparison is trimmed + case-insensitive.
 */
export function resolveSelfEmail(
  caller: McpCaller,
  requestedEmail?: string,
): SelfEmailResolution {
  const requested = requestedEmail?.trim() || undefined;

  if (caller.role === "admin") {
    const email = requested ?? caller.email;
    return email
      ? { ok: true, email }
      : { ok: false, message: EMAIL_REQUIRED_MESSAGE };
  }

  if (!caller.email) {
    // A viewer credential with no bound identity cannot be self-scoped.
    return { ok: false, message: SELF_ONLY_MESSAGE };
  }
  if (!requested || requested.toLowerCase() === caller.email.trim().toLowerCase()) {
    return { ok: true, email: caller.email };
  }
  return { ok: false, message: SELF_ONLY_MESSAGE };
}
