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
