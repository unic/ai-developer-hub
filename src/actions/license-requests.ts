"use server";

import { db } from "@/lib/db";
import {
  licenseRequests,
  licenseAssignments,
  aiTools,
  accessTiers,
  users,
} from "@/lib/db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import {
  approveRequestSchema,
  rejectRequestSchema,
  completeRequestSchema,
  cancelRequestSchema,
} from "@/lib/validators";
import type { ActionResult } from "@/types";
import { postChannelReply, postChatMessage } from "@/lib/teams/graph";

export interface LicenseRequestRow {
  id: number;
  formResponseId: string;
  requesterEmail: string;
  requesterName: string;
  requesterUserId: number | null;
  requestedToolId: number;
  requestedToolName: string;
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

const decidedByUsers = sql<string | null>`decided_user.name`.as("decided_by_name");
const completedByUsers = sql<string | null>`completed_user.name`.as("completed_by_name");

export async function listLicenseRequests(): Promise<LicenseRequestRow[]> {
  const rows = await db.execute(sql`
    SELECT
      lr.id, lr.form_response_id, lr.requester_email, lr.requester_name,
      lr.requester_user_id,
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
      lr.requester_user_id,
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

function mapRow(row: Record<string, unknown>): LicenseRequestRow {
  return {
    id: row.id as number,
    formResponseId: row.form_response_id as string,
    requesterEmail: row.requester_email as string,
    requesterName: row.requester_name as string,
    requesterUserId: (row.requester_user_id as number | null) ?? null,
    requestedToolId: row.requested_tool_id as number,
    requestedToolName: (row.tool_name as string | null) ?? "(unknown)",
    requestedTierId: (row.requested_tier_id as number | null) ?? null,
    requestedTierName: (row.tier_name as string | null) ?? null,
    status: row.status as LicenseRequestRow["status"],
    decidedBy: (row.decided_by as number | null) ?? null,
    decidedByName: (row.decided_by_name as string | null) ?? null,
    decidedAt: (row.decided_at as Date | null) ?? null,
    decisionNote: (row.decision_note as string | null) ?? null,
    completedBy: (row.completed_by as number | null) ?? null,
    completedByName: (row.completed_by_name as string | null) ?? null,
    completedAt: (row.completed_at as Date | null) ?? null,
    approvalMessageMd: (row.approval_message_md as string | null) ?? null,
    completionMessageMd: (row.completion_message_md as string | null) ?? null,
    assignmentId: (row.assignment_id as number | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

// — Mutating actions — ---------------------------------------------------

export async function approveRequest(
  input: unknown,
): Promise<ActionResult<{ requestId: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = approveRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Validation failed",
    };
  }

  const { requestId, bodyMd } = parsed.data;

  // First-write-wins: UPDATE ... WHERE status='pending_review'. Zero rows updated
  // means another admin claimed it first.
  const updated = await db
    .update(licenseRequests)
    .set({
      status: "approved",
      decidedBy: Number(admin.id),
      decidedAt: new Date(),
      approvalMessageMd: bodyMd,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(licenseRequests.id, requestId),
        eq(licenseRequests.status, "pending_review"),
      ),
    )
    .returning({
      id: licenseRequests.id,
      teamsTeamId: licenseRequests.teamsTeamId,
      teamsChannelId: licenseRequests.teamsChannelId,
      teamsParentMessageId: licenseRequests.teamsParentMessageId,
      teamsChatId: licenseRequests.teamsChatId,
    });

  if (updated.length === 0) {
    return {
      success: false,
      error: "This request has already been actioned by another admin. Refresh to see the latest state.",
    };
  }

  const row = updated[0];
  await postToTeamsSafe({
    teamId: row.teamsTeamId,
    channelId: row.teamsChannelId,
    parentMessageId: row.teamsParentMessageId,
    chatId: row.teamsChatId,
    bodyMd,
  });

  revalidatePath("/requests");
  revalidatePath(`/requests/${requestId}`);
  return { success: true, data: { requestId } };
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
    .returning({
      id: licenseRequests.id,
      teamsTeamId: licenseRequests.teamsTeamId,
      teamsChannelId: licenseRequests.teamsChannelId,
      teamsParentMessageId: licenseRequests.teamsParentMessageId,
      teamsChatId: licenseRequests.teamsChatId,
    });

  if (updated.length === 0) {
    return {
      success: false,
      error: "This request has already been actioned by another admin. Refresh to see the latest state.",
    };
  }

  const row = updated[0];
  await postToTeamsSafe({
    teamId: row.teamsTeamId,
    channelId: row.teamsChannelId,
    parentMessageId: row.teamsParentMessageId,
    chatId: row.teamsChatId,
    bodyMd: `**Request rejected.**\n\n${decisionNote}`,
  });

  revalidatePath("/requests");
  revalidatePath(`/requests/${requestId}`);
  return { success: true, data: { requestId } };
}

export async function completeRequest(
  input: unknown,
): Promise<ActionResult<{ requestId: number; assignmentId: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = completeRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Validation failed",
    };
  }

  const { requestId, tierId, licenseCode, assignedAt, bodyMd } = parsed.data;

  // Fetch the request so we have the tool / requester to build the assignment.
  const req = await db.query.licenseRequests.findFirst({
    where: eq(licenseRequests.id, requestId),
    columns: {
      id: true,
      status: true,
      requestedToolId: true,
      requesterUserId: true,
      teamsTeamId: true,
      teamsChannelId: true,
      teamsParentMessageId: true,
      teamsChatId: true,
    },
  });

  if (!req) return { success: false, error: "Request not found" };
  if (req.status !== "approved") {
    return {
      success: false,
      error: `Cannot complete a request in status "${req.status}". Must be "approved".`,
    };
  }
  if (!req.requesterUserId) {
    return {
      success: false,
      error: "Requester is not matched to a Hub user. Create the user first (see /users) and re-link the request.",
    };
  }

  // Fetch tier cost — used for cost_at_assignment_cents.
  const tier = await db.query.accessTiers.findFirst({
    where: eq(accessTiers.id, tierId),
    columns: { id: true, monthlyCostCents: true, toolId: true },
  });
  if (!tier || tier.toolId !== req.requestedToolId) {
    return { success: false, error: "Tier does not belong to the requested tool." };
  }

  // Atomic: create assignment, link to request, transition status.
  const result = await db.transaction(async (tx) => {
    const [assignment] = await tx
      .insert(licenseAssignments)
      .values({
        userId: req.requesterUserId!,
        toolId: req.requestedToolId,
        tierId,
        costAtAssignmentCents: tier.monthlyCostCents,
        assignedAt: new Date(`${assignedAt}T00:00:00Z`),
        apiKeyEncrypted: licenseCode ?? null,
        source: "license-request-workflow",
      })
      .returning({ id: licenseAssignments.id });

    // First-write-wins on completion too.
    const updated = await tx
      .update(licenseRequests)
      .set({
        status: "completed",
        completedBy: Number(admin.id),
        completedAt: new Date(),
        completionMessageMd: bodyMd,
        assignmentId: assignment.id,
        requestedTierId: tierId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(licenseRequests.id, requestId),
          eq(licenseRequests.status, "approved"),
        ),
      )
      .returning({ id: licenseRequests.id });

    if (updated.length === 0) {
      throw new Error("Race condition: request status changed before completion");
    }

    return { assignmentId: assignment.id };
  });

  await postToTeamsSafe({
    teamId: req.teamsTeamId,
    channelId: req.teamsChannelId,
    parentMessageId: req.teamsParentMessageId,
    chatId: req.teamsChatId,
    bodyMd,
  });

  revalidatePath("/requests");
  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/assignments");
  return { success: true, data: { requestId, assignmentId: result.assignmentId } };
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
        // Only pending or approved requests can be cancelled.
        sql`${licenseRequests.status} IN ('pending_review', 'approved')`,
      ),
    )
    .returning({ id: licenseRequests.id });

  if (updated.length === 0) {
    return { success: false, error: "Only pending or approved requests can be cancelled." };
  }

  revalidatePath("/requests");
  revalidatePath(`/requests/${requestId}`);
  return { success: true, data: { requestId } };
}

/** Post the same body to both the channel thread (visible to admins) and
 * the group chat (visible to the requester). Errors are swallowed and
 * logged — the DB transition has already committed; the message is best-effort.
 *
 * When Graph is not configured (IT-112678 pending), both calls no-op. */
async function postToTeamsSafe(args: {
  teamId: string;
  channelId: string;
  parentMessageId: string;
  chatId: string;
  bodyMd: string;
}): Promise<void> {
  await Promise.allSettled([
    postChannelReply({
      teamId: args.teamId,
      channelId: args.channelId,
      parentMessageId: args.parentMessageId,
      bodyMarkdown: args.bodyMd,
    }),
    postChatMessage({
      chatId: args.chatId,
      bodyMarkdown: args.bodyMd,
    }),
  ]).then((results) => {
    for (const r of results) {
      if (r.status === "rejected") {
        console.error("[license-requests] Teams post failed:", r.reason);
      }
    }
  });
}

export async function getRequestContext(requestId: number) {
  const detail = await getLicenseRequest(requestId);
  if (!detail) return null;
  return {
    detail,
    // Tiers for the completion modal (full list for the request's tool).
    tiers: await db.query.accessTiers.findMany({
      where: eq(accessTiers.toolId, detail.requestedToolId),
      columns: { id: true, name: true, monthlyCostCents: true },
      orderBy: (t, { asc }) => [asc(t.name)],
    }),
  };
}
