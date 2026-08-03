"use server";

import { db } from "@/lib/db";
import {
  licenseRequests,
  licenseAssignments,
  accessTiers,
  aiTools,
  users,
} from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { encryptApiKey, decryptApiKey } from "@/lib/crypto";
import {
  approveRequestSchema,
  recordAssignmentSchema,
  linkExistingAssignmentSchema,
  rejectRequestSchema,
  cancelRequestSchema,
} from "@/lib/validators";
import type { ActionResult } from "@/types";
import { recordUpdate } from "@/actions/history";
import {
  buildTierChange,
  isTierChangeError,
  isTierChangeNoop,
  SYNC_MANAGED_TIER_ERROR,
  type ChangeMap,
} from "@/lib/assignments/tier-change";
import {
  isSyncManagedTool,
  getSyncManagedToolId,
} from "@/lib/assignments/sync-authority";
import { revalidateAssignmentCostPaths } from "@/lib/assignments/revalidate";

export interface LicenseRequestRow {
  id: number;
  formResponseId: string;
  requesterEmail: string;
  requesterName: string;
  requesterUserId: number | null;
  requesterRole: "developer" | "conception" | "business" | null;
  requesterProfile: "baseline" | "maxed" | "indie" | null;
  justification: string | null;
  // Derived (v2) or requested (v1) tool; null = needs decision (indie).
  requestedToolId: number | null;
  requestedToolName: string | null;
  requestedTierId: number | null;
  requestedTierName: string | null;
  status: "pending_review" | "approved" | "rejected" | "completed" | "cancelled";
  decidedBy: number | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  completedBy: number | null;
  completedByName: string | null;
  completedAt: Date | null;
  approvalMessageMd: string | null;
  completionMessageMd: string | null;
  assignmentId: number | null;
  createdAt: Date;
}

export interface LicenseRequestDetail extends LicenseRequestRow {
  formPayload: Record<string, unknown>;
  teamsTeamId: string;
  teamsChannelId: string;
  teamsParentMessageId: string;
  teamsChatId: string;
}

/** Open queue size — the sidebar badge on the Requests nav item. */
export async function countPendingLicenseRequests(): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(licenseRequests)
    .where(eq(licenseRequests.status, "pending_review"));
  return rows[0]?.count ?? 0;
}

export async function listLicenseRequests(): Promise<LicenseRequestRow[]> {
  const rows = await db.execute(sql`
    SELECT
      lr.id, lr.form_response_id, lr.requester_email, lr.requester_name,
      lr.requester_user_id, lr.requester_role, lr.requester_profile, lr.justification,
      lr.requested_tool_id, t.name AS tool_name,
      lr.requested_tier_id, ti.name AS tier_name,
      lr.status, lr.decided_by, du.name AS decided_by_name, lr.decided_at, lr.decision_note,
      lr.completed_by, cu.name AS completed_by_name, lr.completed_at,
      lr.approval_message_md, lr.completion_message_md,
      lr.assignment_id, lr.created_at
    FROM license_requests lr
    LEFT JOIN ai_tools t ON t.id = lr.requested_tool_id
    LEFT JOIN access_tiers ti ON ti.id = lr.requested_tier_id
    LEFT JOIN users du ON du.id = lr.decided_by
    LEFT JOIN users cu ON cu.id = lr.completed_by
    ORDER BY lr.created_at DESC
  `);
  return (rows.rows as Array<Record<string, unknown>>).map(mapRow);
}

export async function getLicenseRequest(id: number): Promise<LicenseRequestDetail | null> {
  const rows = await db.execute(sql`
    SELECT
      lr.id, lr.form_response_id, lr.requester_email, lr.requester_name,
      lr.requester_user_id, lr.requester_role, lr.requester_profile, lr.justification,
      lr.requested_tool_id, t.name AS tool_name,
      lr.requested_tier_id, ti.name AS tier_name,
      lr.status, lr.decided_by, du.name AS decided_by_name, lr.decided_at, lr.decision_note,
      lr.completed_by, cu.name AS completed_by_name, lr.completed_at,
      lr.approval_message_md, lr.completion_message_md,
      lr.assignment_id, lr.created_at,
      lr.form_payload, lr.teams_team_id, lr.teams_channel_id,
      lr.teams_parent_message_id, lr.teams_chat_id
    FROM license_requests lr
    LEFT JOIN ai_tools t ON t.id = lr.requested_tool_id
    LEFT JOIN access_tiers ti ON ti.id = lr.requested_tier_id
    LEFT JOIN users du ON du.id = lr.decided_by
    LEFT JOIN users cu ON cu.id = lr.completed_by
    WHERE lr.id = ${id}
    LIMIT 1
  `);
  const row = (rows.rows as Array<Record<string, unknown>>)[0];
  if (!row) return null;
  const base = mapRow(row);
  return {
    ...base,
    formPayload: (row.form_payload as Record<string, unknown>) ?? {},
    teamsTeamId: row.teams_team_id as string,
    teamsChannelId: row.teams_channel_id as string,
    teamsParentMessageId: row.teams_parent_message_id as string,
    teamsChatId: row.teams_chat_id as string,
  };
}

/** Raw db.execute() returns timestamps as strings (no drizzle column mapping)
 * — convert for real. A bare `as Date` cast here is what broke the queue's
 * age-column accessor (`createdAt.getTime is not a function`) whenever
 * TanStack evaluated the row model (search, default filters). */
function toDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") return new Date(v);
  return null;
}

function mapRow(row: Record<string, unknown>): LicenseRequestRow {
  return {
    id: row.id as number,
    formResponseId: row.form_response_id as string,
    requesterEmail: row.requester_email as string,
    requesterName: row.requester_name as string,
    requesterUserId: (row.requester_user_id as number | null) ?? null,
    requesterRole: (row.requester_role as LicenseRequestRow["requesterRole"]) ?? null,
    requesterProfile:
      (row.requester_profile as LicenseRequestRow["requesterProfile"]) ?? null,
    justification: (row.justification as string | null) ?? null,
    requestedToolId: (row.requested_tool_id as number | null) ?? null,
    requestedToolName: (row.tool_name as string | null) ?? null,
    requestedTierId: (row.requested_tier_id as number | null) ?? null,
    requestedTierName: (row.tier_name as string | null) ?? null,
    status: row.status as LicenseRequestRow["status"],
    decidedBy: (row.decided_by as number | null) ?? null,
    decidedByName: (row.decided_by_name as string | null) ?? null,
    decidedAt: toDate(row.decided_at),
    decisionNote: (row.decision_note as string | null) ?? null,
    completedBy: (row.completed_by as number | null) ?? null,
    completedByName: (row.completed_by_name as string | null) ?? null,
    completedAt: toDate(row.completed_at),
    approvalMessageMd: (row.approval_message_md as string | null) ?? null,
    completionMessageMd: (row.completion_message_md as string | null) ?? null,
    assignmentId: (row.assignment_id as number | null) ?? null,
    createdAt: toDate(row.created_at) ?? new Date(0),
  };
}

// — Mutating actions — ---------------------------------------------------

// Sentinel for the first-write-wins race inside transactions: thrown to roll
// back all writes (assignment, auto-created user), caught to surface a clean
// ActionResult instead of a 500.
const RACE_LOST = Symbol("race-lost");

/**
 * A rejection raised from INSIDE an approval transaction.
 *
 * 042 — in Drizzle, returning a value from the transaction callback COMMITS;
 * only a throw rolls back, which is why the race guards throw RACE_LOST. The
 * duplicate-seat refusal used to be *returned*.
 *
 * That was harmless in practice: ensureRequesterUser inserts a user only when no
 * row with that e-mail exists, and a freshly inserted user cannot already hold an
 * active assignment — so the refusal and an insert were mutually exclusive, and
 * it was the only in-transaction error return.
 *
 * It stops being harmless here, because this file now rejects in places that CAN
 * follow a real write (a retier that then loses the request-status race). So the
 * rule is absolute rather than incidental: every in-transaction rejection throws
 * this, never returns.
 */
class ApprovalError extends Error {}

interface AssignmentInputs {
  toolId: number;
  tierId: number;
  assignedAt: string;
  licenseCode?: string;
}

/** Tool + tier only — what a retier needs. A retier has no assignedAt: that is
 * the seat's original start and an upgrade must not rewrite it. */
interface TierOnlyInputs {
  toolId: number;
  tierId: number;
  licenseCode?: string;
}

interface RequesterFields {
  requesterUserId: number | null;
  requesterEmail: string;
  requesterName: string;
  requesterRole: "developer" | "conception" | "business" | null;
  requesterProfile: "baseline" | "maxed" | "indie" | null;
}

/** Validate tool + tier. Returns the rows needed to build or retier an
 * assignment, or an error string.
 *
 * 042: `requireApiKey` is now a parameter rather than an unconditional rule.
 * The API-key requirement is a CREATE-time rule — a retier or a link reuses the
 * seat's stored key — and enforcing it unconditionally made every Claude Console
 * upgrade fail with a misleading message. Claude Console is the only
 * requires_api_key tool and has the deepest tier ladder, so that was precisely
 * the case most likely to arise.
 *
 * 042: also adds the missing `accessTiers.isActive` check. Without it the
 * request path could put a live seat on a deactivated tier — something both
 * updateAssignment and assignLicense already refuse.
 */
async function loadToolAndTier(
  inputs: TierOnlyInputs,
  { requireApiKey }: { requireApiKey: boolean },
) {
  const tool = await db.query.aiTools.findFirst({
    where: eq(aiTools.id, inputs.toolId),
    columns: { id: true, name: true, requiresApiKey: true },
  });
  if (!tool) return { error: "Tool not found." as string, tool: null, tier: null };
  const tier = await db.query.accessTiers.findFirst({
    where: eq(accessTiers.id, inputs.tierId),
    columns: {
      id: true,
      name: true,
      monthlyCostCents: true,
      toolId: true,
      isActive: true,
    },
  });
  if (!tier || tier.toolId !== tool.id) {
    return { error: "Tier does not belong to the selected tool.", tool: null, tier: null };
  }
  if (!tier.isActive) {
    return {
      error: `Tier "${tier.name}" is no longer available for ${tool.name}.`,
      tool: null,
      tier: null,
    };
  }
  if (requireApiKey && tool.requiresApiKey && !inputs.licenseCode?.trim()) {
    return {
      error: `${tool.name} assignments carry an API key — enter the key you provisioned.`,
      tool: null,
      tier: null,
    };
  }
  return { error: null, tool, tier };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Resolve the requester to a Hub user inside the approval transaction,
 * creating one when none exists (032-v2 decision: users are created at
 * approval — never at ingest, never from rejected requests). Created users are
 * viewers without an invite; the random hex passwordHash can never match a
 * bcrypt compare, so the account has no usable login until invited. */
async function ensureRequesterUser(
  tx: Tx,
  req: RequesterFields,
): Promise<number> {
  if (req.requesterUserId) return req.requesterUserId;

  const email = req.requesterEmail.toLowerCase();
  const existing = await tx.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true },
  });
  if (existing) return existing.id;

  const inserted = await tx
    .insert(users)
    .values({
      name: req.requesterName,
      email,
      passwordHash: randomBytes(32).toString("hex"),
      role: "viewer",
      discipline: req.requesterRole ?? "developer",
      // user_profile has no "baseline" value — baseline requesters keep NULL.
      profile:
        req.requesterProfile === "maxed" || req.requesterProfile === "indie"
          ? req.requesterProfile
          : null,
    })
    .onConflictDoNothing()
    .returning({ id: users.id });
  if (inserted.length > 0) return inserted[0].id;

  // Lost a concurrent-create race on the email unique index — re-read.
  const raced = await tx.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true },
  });
  if (!raced) throw new Error("Failed to create requester user");
  return raced.id;
}

/** Duplicate-seat guard + assignment insert, shared by approve and the legacy
 * record-assignment path. Returns the new assignment id, or THROWS
 * ApprovalError so the auto-created requester user rolls back with it. */
async function createAssignmentInTx(
  tx: Tx,
  userId: number,
  inputs: AssignmentInputs,
  monthlyCostCents: number,
): Promise<{ assignmentId: number }> {
  const existingActive = await tx.query.licenseAssignments.findFirst({
    where: and(
      eq(licenseAssignments.userId, userId),
      eq(licenseAssignments.toolId, inputs.toolId),
      eq(licenseAssignments.status, "active"),
    ),
    columns: { id: true },
  });
  if (existingActive) {
    // 042: this is now a throw, not a return — see ApprovalError. The advice has
    // also changed: retiering is a first-class outcome, so "revoke first" is no
    // longer the only way out.
    throw new ApprovalError(
      `Requester already has an active assignment for this tool (assignment #${existingActive.id}). Approve it as a tier change instead, or cancel this request.`,
    );
  }

  const apiKeyEncrypted = inputs.licenseCode?.trim()
    ? await encryptApiKey(inputs.licenseCode.trim())
    : null;

  const [assignment] = await tx
    .insert(licenseAssignments)
    .values({
      userId,
      toolId: inputs.toolId,
      tierId: inputs.tierId,
      costAtAssignmentCents: monthlyCostCents,
      assignedAt: new Date(`${inputs.assignedAt}T00:00:00Z`),
      apiKeyEncrypted,
      source: "license-request-workflow",
    })
    .returning({ id: licenseAssignments.id });
  return { assignmentId: assignment.id };
}

/**
 * Load the assignment a retier/link targets and prove it belongs to this
 * requester. Throws ApprovalError rather than returning, so nothing commits.
 *
 * Deliberately resolves the user FROM the assignment instead of calling
 * ensureRequesterUser: these two modes require the seat to already exist, so the
 * user necessarily exists too, and never touching the users table makes it
 * impossible to leak one. The ownership check is by id when the request is
 * already linked to a Hub user, otherwise by e-mail — matching how
 * ensureRequesterUser resolves a requester, so a request whose requesterUserId
 * is still NULL but whose e-mail matches an existing user behaves consistently.
 */
async function loadTargetAssignmentInTx(
  tx: Tx,
  req: RequesterFields,
  assignmentId: number,
): Promise<{
  id: number;
  userId: number;
  toolId: number;
  tierId: number;
  costAtAssignmentCents: number;
}> {
  const assignment = await tx.query.licenseAssignments.findFirst({
    where: eq(licenseAssignments.id, assignmentId),
    columns: {
      id: true,
      userId: true,
      toolId: true,
      tierId: true,
      costAtAssignmentCents: true,
      status: true,
    },
    with: { user: { columns: { id: true, email: true } } },
  });

  if (!assignment) throw new ApprovalError("Assignment not found.");
  if (assignment.status !== "active") {
    throw new ApprovalError(
      "That assignment is no longer active. Reopen the dialog and approve it as a new licence instead.",
    );
  }

  const belongsToRequester = req.requesterUserId
    ? assignment.userId === req.requesterUserId
    : assignment.user.email.toLowerCase() === req.requesterEmail.toLowerCase();
  if (!belongsToRequester) {
    throw new ApprovalError(
      "That assignment belongs to a different user than the requester.",
    );
  }

  return {
    id: assignment.id,
    userId: assignment.userId,
    toolId: assignment.toolId,
    tierId: assignment.tierId,
    costAtAssignmentCents: assignment.costAtAssignmentCents,
  };
}

/** 032-v2: approval is the terminal happy path — provision-first. In one
 * transaction: auto-create the requester's Hub user when missing, create the
 * license assignment, and transition pending_review → approved with the
 * message stored (licenseCode token unresolved — see getRequestMessage).
 *
 * 042: approval now has three shapes, because "the requester already holds this
 * tool" is a normal case rather than an error:
 *   create        — insert a new assignment (the original behaviour)
 *   change_tier   — retier the seat they already hold, in place
 *   link_existing — approve and link an already-provisioned seat, mutating
 *                   nothing. The only approvable outcome for a sync-managed tool
 *                   (GitHub owns Copilot entitlements), and the escape hatch for
 *                   the legacy record-assignment path.
 */
export async function approveRequest(
  input: unknown,
): Promise<ActionResult<{ requestId: number; assignmentId: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = approveRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Validation failed",
    };
  }
  const approval = parsed.data;
  const { requestId, bodyMd } = approval;

  const req = await db.query.licenseRequests.findFirst({
    where: eq(licenseRequests.id, requestId),
    columns: {
      id: true,
      status: true,
      requesterUserId: true,
      requesterEmail: true,
      requesterName: true,
      requesterRole: true,
      requesterProfile: true,
    },
  });
  if (!req) return { success: false, error: "Request not found" };
  if (req.status !== "pending_review") {
    return {
      success: false,
      error: `Cannot approve a request in status "${req.status}".`,
    };
  }

  // Tool/tier validation happens outside the transaction, as before. The
  // API-key rule is create-only: a retier reuses the seat's stored key.
  let tier: { id: number; monthlyCostCents: number } | null = null;
  if (approval.mode !== "link_existing") {
    const loaded = await loadToolAndTier(approval, {
      requireApiKey: approval.mode === "create",
    });
    if (loaded.error) return { success: false, error: loaded.error };
    tier = loaded.tier;
  }

  // A retier on a sync-managed tool would be reverted by the next cron, so it is
  // refused here rather than silently undone later. link_existing remains
  // available and is the intended route for those seats.
  if (approval.mode === "change_tier" && (await isSyncManagedTool(approval.toolId))) {
    return { success: false, error: SYNC_MANAGED_TIER_ERROR };
  }

  const result = await db
    .transaction(async (tx) => {
      let assignmentId: number;
      let userId: number;
      let toolId: number;
      let changes: ChangeMap | null = null;

      if (approval.mode === "create") {
        userId = await ensureRequesterUser(tx, req);
        const created = await createAssignmentInTx(
          tx,
          userId,
          approval,
          tier!.monthlyCostCents,
        );
        assignmentId = created.assignmentId;
        toolId = approval.toolId;
      } else {
        const target = await loadTargetAssignmentInTx(
          tx,
          req,
          approval.assignmentId,
        );
        assignmentId = target.id;
        userId = target.userId;
        toolId = target.toolId;

        if (approval.mode === "change_tier") {
          const outcome = buildTierChange(
            {
              tierId: target.tierId,
              costAtAssignmentCents: target.costAtAssignmentCents,
              // Already refused above; the tool cannot change mid-transaction.
              isSyncManaged: false,
            },
            { id: tier!.id, monthlyCostCents: tier!.monthlyCostCents },
          );
          if (isTierChangeError(outcome)) {
            throw new ApprovalError(outcome.error);
          }
          // A no-op still has to approve and link the request — returning early
          // here would strand it in pending_review forever.
          if (!isTierChangeNoop(outcome)) {
            const retiered = await tx
              .update(licenseAssignments)
              .set({ ...outcome.values, updatedAt: new Date() })
              .where(
                and(
                  eq(licenseAssignments.id, target.id),
                  eq(licenseAssignments.status, "active"),
                  eq(licenseAssignments.tierId, target.tierId),
                ),
              )
              .returning({ id: licenseAssignments.id });
            if (retiered.length === 0) throw RACE_LOST;
            changes = outcome.changes;
          }
        }
      }

      const updated = await tx
        .update(licenseRequests)
        .set({
          status: "approved",
          decidedBy: Number(admin.id),
          decidedAt: new Date(),
          approvalMessageMd: bodyMd,
          assignmentId,
          requesterUserId: userId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(licenseRequests.id, requestId),
            eq(licenseRequests.status, "pending_review"),
          ),
        )
        .returning({ id: licenseRequests.id });
      if (updated.length === 0) throw RACE_LOST;

      if (changes) {
        await recordUpdate(
          "license_assignment",
          assignmentId,
          Number(admin.id),
          changes,
          tx,
        );
      }

      return { assignmentId, userId, toolId };
    })
    .catch((err) => {
      if (err === RACE_LOST) return null;
      if (err instanceof ApprovalError) return { error: err.message };
      throw err;
    });

  if (result === null) {
    return {
      success: false,
      error:
        "This request has already been actioned by another admin. Refresh to see the latest state.",
    };
  }
  if ("error" in result) return { success: false, error: result.error };

  revalidatePath("/requests");
  revalidatePath(`/requests/${requestId}`);
  revalidatePath(`/assignments/${result.assignmentId}`);
  revalidatePath("/users");
  revalidateAssignmentCostPaths(result.userId, result.toolId);
  return {
    success: true,
    data: { requestId, assignmentId: result.assignmentId },
  };
}

/** Legacy migration path (032-v2): requests approved under v1 semantics have
 * no assignment. Attach one — same step-1 inputs as approval, no message, no
 * re-approval. Guarded on status='approved' AND assignment_id IS NULL. */
export async function recordAssignment(
  input: unknown,
): Promise<ActionResult<{ requestId: number; assignmentId: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = recordAssignmentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Validation failed",
    };
  }
  const { requestId, ...assignmentInputs } = parsed.data;

  const req = await db.query.licenseRequests.findFirst({
    where: eq(licenseRequests.id, requestId),
    columns: {
      id: true,
      status: true,
      assignmentId: true,
      requesterUserId: true,
      requesterEmail: true,
      requesterName: true,
      requesterRole: true,
      requesterProfile: true,
    },
  });
  if (!req) return { success: false, error: "Request not found" };
  if (req.status !== "approved" || req.assignmentId !== null) {
    return {
      success: false,
      error: "Only approved requests without an assignment can record one.",
    };
  }

  // Create-time inputs, so the API-key rule applies here as it always did.
  const { error: toolError, tier } = await loadToolAndTier(assignmentInputs, {
    requireApiKey: true,
  });
  if (toolError) return { success: false, error: toolError };

  const result = await db
    .transaction(async (tx) => {
      const userId = await ensureRequesterUser(tx, req);
      const created = await createAssignmentInTx(
        tx,
        userId,
        assignmentInputs,
        tier!.monthlyCostCents,
      );

      const updated = await tx
        .update(licenseRequests)
        .set({
          assignmentId: created.assignmentId,
          requesterUserId: userId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(licenseRequests.id, requestId),
            eq(licenseRequests.status, "approved"),
            sql`${licenseRequests.assignmentId} IS NULL`,
          ),
        )
        .returning({ id: licenseRequests.id });
      if (updated.length === 0) throw RACE_LOST;

      return { assignmentId: created.assignmentId, userId };
    })
    .catch((err) => {
      if (err === RACE_LOST) return null;
      // 042: the duplicate-seat refusal now throws, so this path inherits the
      // rollback too — previously it committed an auto-created user as well.
      if (err instanceof ApprovalError) return { error: err.message };
      throw err;
    });

  if (result === null) {
    return {
      success: false,
      error:
        "This request was actioned by another admin while you were entering details. Refresh to see the latest state.",
    };
  }
  if ("error" in result) return { success: false, error: result.error };

  revalidateAssignmentCostPaths(result.userId, assignmentInputs.toolId);

  revalidatePath("/requests");
  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/assignments");
  revalidatePath("/users");
  return {
    success: true,
    data: { requestId, assignmentId: result.assignmentId },
  };
}

/**
 * 042: link an already-existing seat to a v1-approved request.
 *
 * The gap this closes: `recordAssignment` can only CREATE, so a legacy approved
 * request whose requester already holds the tool was permanently stuck — the
 * create path hits the duplicate-seat guard, and `approveRequest`'s new
 * `link_existing` mode cannot help because it requires
 * `status='pending_review'` while these rows are already `'approved'`. The two
 * guards are mutually exclusive, so the legacy path needs its own linker.
 *
 * Mutates nothing on the assignment — it only fills in the missing link.
 */
export async function linkExistingAssignment(
  input: unknown,
): Promise<ActionResult<{ requestId: number; assignmentId: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = linkExistingAssignmentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Validation failed",
    };
  }
  const { requestId, assignmentId } = parsed.data;

  const req = await db.query.licenseRequests.findFirst({
    where: eq(licenseRequests.id, requestId),
    columns: {
      id: true,
      status: true,
      assignmentId: true,
      requesterUserId: true,
      requesterEmail: true,
      requesterName: true,
      requesterRole: true,
      requesterProfile: true,
    },
  });
  if (!req) return { success: false, error: "Request not found" };
  if (req.status !== "approved" || req.assignmentId !== null) {
    return {
      success: false,
      error: "Only approved requests without an assignment can link one.",
    };
  }

  const result = await db
    .transaction(async (tx) => {
      // Same ownership/active checks as a retier — never creates a user.
      const target = await loadTargetAssignmentInTx(tx, req, assignmentId);

      const updated = await tx
        .update(licenseRequests)
        .set({
          assignmentId: target.id,
          requesterUserId: target.userId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(licenseRequests.id, requestId),
            eq(licenseRequests.status, "approved"),
            sql`${licenseRequests.assignmentId} IS NULL`,
          ),
        )
        .returning({ id: licenseRequests.id });
      if (updated.length === 0) throw RACE_LOST;

      return { assignmentId: target.id };
    })
    .catch((err) => {
      if (err === RACE_LOST) return null;
      if (err instanceof ApprovalError) return { error: err.message };
      throw err;
    });

  if (result === null) {
    return {
      success: false,
      error:
        "This request was actioned by another admin while you were entering details. Refresh to see the latest state.",
    };
  }
  if ("error" in result) return { success: false, error: result.error };

  revalidatePath("/requests");
  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/assignments");
  return {
    success: true,
    data: { requestId, assignmentId: result.assignmentId },
  };
}

export async function rejectRequest(
  input: unknown,
): Promise<ActionResult<{ requestId: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = rejectRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Validation failed",
    };
  }

  const { requestId, decisionNote } = parsed.data;

  const updated = await db
    .update(licenseRequests)
    .set({
      status: "rejected",
      decidedBy: Number(admin.id),
      decidedAt: new Date(),
      decisionNote,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(licenseRequests.id, requestId),
        eq(licenseRequests.status, "pending_review"),
      ),
    )
    .returning({ id: licenseRequests.id });

  if (updated.length === 0) {
    return {
      success: false,
      error: "This request has already been actioned by another admin. Refresh to see the latest state.",
    };
  }

  revalidatePath("/requests");
  revalidatePath(`/requests/${requestId}`);
  return { success: true, data: { requestId } };
}

export async function cancelRequest(
  input: unknown,
): Promise<ActionResult<{ requestId: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = cancelRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }

  const { requestId } = parsed.data;

  const updated = await db
    .update(licenseRequests)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(licenseRequests.id, requestId),
        // Only pending requests can be cancelled — approved is terminal since 032-v2.
        eq(licenseRequests.status, "pending_review"),
      ),
    )
    .returning({ id: licenseRequests.id });

  if (updated.length === 0) {
    return { success: false, error: "Only pending requests can be cancelled." };
  }

  revalidatePath("/requests");
  revalidatePath(`/requests/${requestId}`);
  return { success: true, data: { requestId } };
}

// — Read-side helpers for the detail page — --------------------------------

export interface ToolOption {
  id: number;
  name: string;
  requiresApiKey: boolean;
  tiers: Array<{ id: number; name: string; monthlyCostCents: number }>;
}

export interface ActiveAssignmentSummary {
  id: number;
  // 042: toolId/tierId/syncManaged added so the approval dialog can decide what
  // it is looking at. Matching the approver's selected tool by display NAME was
  // the alternative, and it could not distinguish a sync-managed seat at all —
  // which is the single most likely collision, Copilot being at 63/63 seats.
  toolId: number;
  toolName: string;
  tierId: number;
  tierName: string;
  tierCostCents: number;
  /** GitHub owns this seat's plan; it can be linked but not retiered. */
  syncManaged: boolean;
  assignedAt: Date;
}

export async function getRequestContext(requestId: number) {
  const detail = await getLicenseRequest(requestId);
  if (!detail) return null;

  // All active tools + their tiers — the approver can override the derived
  // tool (or pick one for indie), so the full catalog is needed.
  const toolRows = await db.query.aiTools.findMany({
    where: eq(aiTools.status, "active"),
    columns: { id: true, name: true, requiresApiKey: true },
    orderBy: (t, { asc }) => [asc(t.name)],
  });
  const tierRows = await db.query.accessTiers.findMany({
    columns: { id: true, name: true, monthlyCostCents: true, toolId: true },
    orderBy: (t, { asc }) => [asc(t.name)],
  });
  const tools: ToolOption[] = toolRows.map((t) => ({
    id: t.id,
    name: t.name,
    requiresApiKey: t.requiresApiKey,
    tiers: tierRows
      .filter((tier) => tier.toolId === t.id)
      .map(({ id, name, monthlyCostCents }) => ({ id, name, monthlyCostCents })),
  }));

  // The requester's existing active assignments — add-on review context (the
  // guide's "one tool per profile; combining needs justification" rule) and,
  // since 042, the basis for offering a tier change instead of a create.
  //
  // Resolved by user id when the request is already linked, otherwise by e-mail.
  // approveRequest's ensureRequesterUser resolves the same way, so keying only on
  // requesterUserId (as this did) meant a request whose user row exists but is
  // not yet linked showed NO collision in the dialog and then failed server-side.
  const syncManagedToolId = await getSyncManagedToolId();
  const rows = await db.execute(sql`
      SELECT la.id, la.tool_id, la.tier_id, la.assigned_at,
             t.name AS tool_name,
             ti.name AS tier_name, ti.monthly_cost_cents
      FROM license_assignments la
      JOIN ai_tools t ON t.id = la.tool_id
      JOIN access_tiers ti ON ti.id = la.tier_id
      JOIN users u ON u.id = la.user_id
      WHERE la.status = 'active'
        AND (
          u.id = ${detail.requesterUserId ?? null}
          OR lower(u.email) = ${detail.requesterEmail.toLowerCase()}
        )
      ORDER BY la.assigned_at DESC
    `);
  const activeAssignments: ActiveAssignmentSummary[] = (
    rows.rows as Array<Record<string, unknown>>
  ).map((r) => ({
    id: r.id as number,
    toolId: r.tool_id as number,
    toolName: r.tool_name as string,
    tierId: r.tier_id as number,
    tierName: r.tier_name as string,
    tierCostCents: Number(r.monthly_cost_cents ?? 0),
    syncManaged:
      syncManagedToolId !== null && (r.tool_id as number) === syncManagedToolId,
    assignedAt: toDate(r.assigned_at) ?? new Date(0),
  }));

  return { detail, tools, activeAssignments };
}

const LICENSE_CODE_TOKEN = /\{\{\s*licenseCode\s*\}\}/g;
const MASKED_CODE = "••••••••••••";

/** Resolve a stored request message for display or copy. Stored messages keep
 * the {{licenseCode}} token unresolved so the audit log never holds a second,
 * unencrypted copy of the key — the only plaintext source is the encrypted
 * assignment column, decrypted here on demand (admin-only). */
export async function getRequestMessage(
  input: { requestId: number; kind: "approval" | "completion"; reveal: boolean },
): Promise<ActionResult<{ bodyMd: string; containsKey: boolean }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const req = await db.query.licenseRequests.findFirst({
    where: eq(licenseRequests.id, input.requestId),
    columns: { approvalMessageMd: true, completionMessageMd: true, assignmentId: true },
  });
  if (!req) return { success: false, error: "Request not found" };

  const stored =
    input.kind === "approval" ? req.approvalMessageMd : req.completionMessageMd;
  if (!stored) return { success: false, error: "No message stored." };

  const containsKey = LICENSE_CODE_TOKEN.test(stored);
  LICENSE_CODE_TOKEN.lastIndex = 0;
  if (!containsKey) {
    return { success: true, data: { bodyMd: stored, containsKey } };
  }

  let replacement = MASKED_CODE;
  if (input.reveal) {
    if (!req.assignmentId) {
      return { success: false, error: "No assignment linked — the key is not available." };
    }
    const assignment = await db.query.licenseAssignments.findFirst({
      where: eq(licenseAssignments.id, req.assignmentId),
      columns: { apiKeyEncrypted: true },
    });
    if (!assignment?.apiKeyEncrypted) {
      return { success: false, error: "No key stored on the linked assignment." };
    }
    replacement = await decryptApiKey(assignment.apiKeyEncrypted);
  }

  return {
    success: true,
    data: { bodyMd: stored.replace(LICENSE_CODE_TOKEN, replacement), containsKey },
  };
}
