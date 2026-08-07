/**
 * Actor-parameterized write context (043-mcp-write-tools).
 *
 * Every mutation in the Hub used to live in a `"use server"` action gated on
 * `requireAdmin()`, which reads the NextAuth session. MCP callers have no
 * session, and `change_history.changedBy` needs a real `users.id`, so the actor
 * has to become a parameter.
 *
 * It could NOT become a parameter on the Server Actions themselves: every
 * export of a `"use server"` file is a client-callable RPC endpoint whose
 * arguments are attacker-controlled, so `assignLicense(input, ctx)` would let
 * any client forge `ctx.caps` and `ctx.actorId`. Hence this plain module, with
 * the Server Action as a session-deriving wrapper and the MCP tool as a
 * token-deriving wrapper.
 */

import type { ChangeSource } from "@/lib/history";

/**
 * What a caller is allowed to reach. Enforced INSIDE the cores, next to the row
 * they just loaded — not at the tool boundary — so the guarantees hold even for
 * a caller someone adds later without reading spec 043.
 */
export interface WriteCaps {
  /** May accept or return provisioned secrets (API keys, license codes). */
  secrets: boolean;
  /** May mint or reveal credentials (invite URLs, password resets). */
  credentials: boolean;
  /**
   * May target privileged rows (admin users, agent users) or mutate the fields
   * that confer privilege or control credential delivery (`role`, `email`).
   */
  privilegedTargets: boolean;
  /**
   * May silently deactivate-and-replace a user's existing active assignment for
   * a tool. The UI dialog relies on this (it is how a retier works); MCP must
   * refuse and point at update_assignment instead, so an agent cannot flip an
   * assignment's status as an invisible side effect of "assign".
   */
  replaceAssignments: boolean;
  /**
   * May write state an automated sync owns and would revert. Two things fall
   * under it, both still reachable from the Hub UI today:
   *   - a tier's PRICE (setTierPriceCore) — an admin editing the Copilot price
   *     gets overwritten at 06:00 too, and 042 did not remove that affordance,
   *     so this stays `true` for the UI rather than changing UI behavior;
   *   - REVOKING a sync-provisioned seat (revokeLicenseCore) — the UI already
   *     withholds this itself (assignments-client hides Revoke on
   *     `source='copilot-sync'` rows), so `true` here changes nothing there.
   * MCP refuses both, because an agent reporting a success that silently
   * reverts within 24 hours is worse than one that explains why it will not try.
   *
   * It does NOT govern a per-seat TIER CHANGE: that is refused for every caller,
   * UI included, by `buildTierChange` (spec 042, src/lib/assignments/tier-change.ts).
   * Do not add a caps check there — it would hand the UI back an ability 042
   * shipped to production without.
   */
  syncOwnedFields: boolean;
}

/** The session-backed UI path keeps every capability it has today. */
export const UI_CAPS: WriteCaps = {
  secrets: true,
  credentials: true,
  privilegedTargets: true,
  replaceAssignments: true,
  syncOwnedFields: true,
};

/** The MCP path is capability-reduced on every axis. */
export const MCP_CAPS: WriteCaps = {
  secrets: false,
  credentials: false,
  privilegedTargets: false,
  replaceAssignments: false,
  syncOwnedFields: false,
};

/**
 * Human-readable echoes of the target row, supplied by the caller and verified
 * by the core against the row it loaded. A numeric id an LLM guessed, or read
 * out of a stale response, is the single most likely failure mode on the MCP
 * surface; these turn a silent wrong-row write into a refusal.
 */
export interface WriteExpectations {
  userEmail?: string;
  toolName?: string;
  tierName?: string;
  /** Guards against a preview taken before someone else moved the price. */
  monthlyCostCents?: number;
}

export interface WriteContext {
  /** `users.id` this write is attributed to. Never optional, never inferred. */
  actorId: number;
  source: ChangeSource;
  caps: WriteCaps;
  expect?: WriteExpectations;
  /**
   * `false` runs every precondition and builds the full diff, then stops before
   * any insert/update and before any audit write. This is what makes a preview
   * provably write-free rather than write-free by inspection.
   */
  commit: boolean;
}

/** Convenience for the Server Action wrappers. */
export function uiContext(actorId: number): WriteContext {
  return { actorId, source: "ui", caps: UI_CAPS, commit: true };
}

// ---- Core result shape ----

/**
 * Cores return this instead of calling `revalidatePath` themselves: the paths
 * to invalidate depend on what actually changed (a tier rename busts far less
 * than a price change that propagated), and that condition is only knowable
 * inside the core. The Server Action wrapper replays the list through
 * `revalidatePath`; the MCP adapter replays it through `revalidateQuietly`.
 */
export interface CoreOk<T> {
  ok: true;
  data: T;
  revalidate: string[];
  /**
   * The requested state already held — nothing was written. Distinct from a
   * refusal on purpose: the MCP adapter renders this as SUCCESS (an `isError`
   * here would contradict `idempotentHint: true` and, after a lost response on
   * a committed call, teach the agent that a retry failed), while the UI
   * wrapper still renders today's error string so UI behavior is unchanged.
   */
  noop?: boolean;
  /** Non-blocking advisory surfaced to the caller (e.g. a backdated date). */
  warning?: string;
}

export interface CoreErr {
  ok: false;
  error: string;
  /** Set when the write was refused by a capability, not by a precondition. */
  refusedByCaps?: boolean;
  fieldErrors?: Record<string, string[]>;
}

export type CoreResult<T> = CoreOk<T> | CoreErr;

export function coreOk<T>(
  data: T,
  revalidate: string[] = [],
  extra: { noop?: boolean; warning?: string } = {},
): CoreOk<T> {
  return { ok: true, data, revalidate, ...extra };
}

export function coreErr(
  error: string,
  extra: { refusedByCaps?: boolean; fieldErrors?: Record<string, string[]> } = {},
): CoreErr {
  return { ok: false, error, ...extra };
}

// ---- Capability refusal messages ----
// Phrased for an LLM reader: each names the boundary and the alternative route,
// so the agent redirects instead of retrying.

export const MCP_NO_SECRETS_MESSAGE =
  "MCP cannot accept or return API keys or license codes. Create or edit this " +
  "assignment at /assignments in the Hub so the credential never crosses the MCP boundary.";

export const MCP_NO_CREDENTIALS_MESSAGE =
  "MCP cannot mint or reveal credentials (invite links, password resets). " +
  "Send the invite from /users — select the user — Send invite.";

export const MCP_PRIVILEGED_TARGET_MESSAGE =
  "This target holds the admin role or is an automation account, so it cannot be " +
  "modified over MCP. Make this change in the Hub UI.";

export const MCP_PRIVILEGED_FIELD_MESSAGE =
  "This field cannot be set over MCP because it controls account privilege or " +
  "credential delivery. Change it in the Hub UI at /users.";

export const MCP_SELF_TARGET_MESSAGE =
  "This credential is bound to the account you are targeting. Refusing so an " +
  "agent cannot lock its own operator out.";

export const MCP_LAST_ADMIN_MESSAGE =
  "Refusing: this is the last active admin account, and deactivating it would " +
  "leave the Hub with no administrator.";

/** Echo-mismatch refusal. Names what was actually found so the agent can re-read. */
export function targetMismatchMessage(
  field: string,
  expected: string,
  actual: string,
): string {
  return (
    `Target mismatch: you passed ${field} "${expected}" but that record is "${actual}". ` +
    "Re-read the record (list_license_assignments / list_ai_tools / find_users) and retry " +
    "with the correct id — refusing so a stale or guessed id cannot modify the wrong record."
  );
}
