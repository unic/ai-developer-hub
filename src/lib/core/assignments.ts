/**
 * License assignment write cores (043-mcp-write-tools).
 *
 * Extracted from src/actions/assignments.ts. Behavior is preserved verbatim for
 * the UI caller; the MCP caller diverges only where `ctx.caps` says so, and each
 * divergence is commented with why.
 */

import { and, count, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  accessTiers,
  aiTools,
  licenseAssignments,
  users,
} from "@/lib/db/schema";
import { encryptApiKey } from "@/lib/crypto";
import { recordCreation, recordStatusChange, recordUpdate } from "@/lib/history";
import { assignmentCostPaths } from "@/lib/assignments/cost-paths";
import { isSyncManagedTool } from "@/lib/assignments/sync-authority";
import {
  buildTierChange,
  isTierChangeError,
  isTierChangeNoop,
} from "@/lib/assignments/tier-change";
import {
  coreErr,
  coreOk,
  MCP_NO_SECRETS_MESSAGE,
  targetMismatchMessage,
  type CoreResult,
  type WriteContext,
} from "@/lib/core/context";
import { isUniqueViolationOn } from "@/lib/core/tools";
import { assignmentSchema, updateAssignmentSchema } from "@/lib/validators";

/** Name of the partial unique index added in migration 0030. */
export const ONE_ACTIVE_ASSIGNMENT_INDEX = "license_assignments_one_active_idx";

/**
 * Refusal for revoking a seat GitHub owns. The seat's existence — not the Hub's
 * row — is the source of truth, so the next sync restores it.
 */
export const SYNC_MANAGED_REVOKE_MESSAGE =
  "This seat is provisioned by GitHub Copilot sync and would be restored on the " +
  "next sync (06:00 UTC), so revoking it here releases no cost. Remove the seat " +
  "in GitHub instead.";

export interface AssignLicenseResult {
  assignmentId: number;
  userId: number;
  userEmail: string;
  toolId: number;
  toolName: string;
  tierId: number;
  tierName: string;
  monthlyCostCents: number;
  /**
   * False when the account cannot sign in yet (no password set and no invite
   * delivered). Surfaced so an agent does not report "onboarded" after creating
   * a billable seat on an account nobody can log into.
   */
  userCanSignIn: boolean;
}

export async function assignLicenseCore(
  ctx: WriteContext,
  input: unknown,
): Promise<CoreResult<AssignLicenseResult>> {
  const parsed = assignmentSchema.safeParse(input);
  if (!parsed.success) return coreErr("Validation failed");

  const { userId, toolId, tierId, workspace, apiKey } = parsed.data;

  if (apiKey !== undefined && apiKey !== "" && !ctx.caps.secrets) {
    return coreErr(MCP_NO_SECRETS_MESSAGE, { refusedByCaps: true });
  }

  const user = await db.query.users.findFirst({
    where: and(eq(users.id, userId), eq(users.status, "active")),
  });
  if (!user) return coreErr("User not found or inactive");

  const echo = checkUserEmailEcho(ctx, user.email);
  if (echo) return echo;

  const tool = await db.query.aiTools.findFirst({
    where: and(eq(aiTools.id, toolId), eq(aiTools.status, "active")),
  });
  if (!tool) return coreErr("Tool not found or archived");

  const tier = await db.query.accessTiers.findFirst({
    where: and(
      eq(accessTiers.id, tierId),
      eq(accessTiers.toolId, toolId),
      eq(accessTiers.isActive, true),
    ),
  });
  if (!tier) return coreErr("Tier not found or not available");

  // An assignment for a key-bearing tool without its key is a broken register
  // row. Refuse rather than create one MCP cannot complete.
  if (tool.requiresApiKey && !ctx.caps.secrets) {
    return coreErr(
      `Assignments for ${tool.name} carry a provisioned API key, which cannot ` +
        `cross the MCP boundary. Create this assignment at /assignments in the Hub.`,
      { refusedByCaps: true },
    );
  }

  const existingAssignment = await db.query.licenseAssignments.findFirst({
    where: and(
      eq(licenseAssignments.userId, userId),
      eq(licenseAssignments.toolId, toolId),
      eq(licenseAssignments.status, "active"),
    ),
  });

  // The UI dialog's "assign" doubles as a retier: it deactivates the existing
  // active row and inserts a new one. Over MCP that is an invisible status flip,
  // so refuse and name the tool that does it explicitly.
  if (existingAssignment && !ctx.caps.replaceAssignments) {
    return coreErr(
      `${user.email} already holds active assignment #${existingAssignment.id} for ` +
        `${tool.name}. Use update_assignment to change its tier, or revoke_license first.`,
      { refusedByCaps: true },
    );
  }

  // FR-006 license capacity. The minus-1 stays: copilot-sync sets maxLicenses to
  // the synced seat total, so tools sit routinely at EXACTLY capacity, and this
  // is what lets the UI retier an existing holder (which adds zero net seats).
  // Unreachable from MCP because the refusal above fires first.
  if (tool.maxLicenses !== null) {
    const [activeCount] = await db
      .select({ count: count() })
      .from(licenseAssignments)
      .where(
        and(
          eq(licenseAssignments.toolId, toolId),
          eq(licenseAssignments.status, "active"),
        ),
      );

    const effectiveCount = existingAssignment
      ? activeCount.count - 1
      : activeCount.count;

    if (effectiveCount >= tool.maxLicenses) {
      return coreErr("License capacity limit reached");
    }
  }

  const userCanSignIn = !user.mustChangePassword;

  const preview: AssignLicenseResult = {
    assignmentId: 0,
    userId,
    userEmail: user.email,
    toolId,
    toolName: tool.name,
    tierId,
    tierName: tier.name,
    // FR-020: cost is snapshotted from the tier, NEVER from caller input.
    monthlyCostCents: tier.monthlyCostCents,
    userCanSignIn,
  };
  if (!ctx.commit) return coreOk(preview);

  // Encrypt before the transaction so crypto does not hold a DB connection.
  const apiKeyEncrypted =
    apiKey && apiKey !== "" ? await encryptApiKey(apiKey) : null;

  const now = new Date();
  let assignmentId: number;
  try {
    assignmentId = await db.transaction(async (tx) => {
      await tx
        .update(licenseAssignments)
        .set({ status: "inactive", revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(licenseAssignments.userId, userId),
            eq(licenseAssignments.toolId, toolId),
            eq(licenseAssignments.status, "active"),
          ),
        );

      const [created] = await tx
        .insert(licenseAssignments)
        .values({
          userId,
          toolId,
          tierId,
          costAtAssignmentCents: tier.monthlyCostCents,
          status: "active",
          assignedAt: now,
          workspace: workspace ?? null,
          apiKeyEncrypted,
          source: ctx.source === "ui" ? "manual" : ctx.source,
        })
        .returning({ id: licenseAssignments.id });

      await recordCreation("license_assignment", created.id, ctx.actorId, {
        tx,
        source: ctx.source,
      });
      return created.id;
    });
  } catch (err) {
    // The pre-check above has a TOCTOU window; the partial unique index closes
    // it, and this maps the violation to the same friendly refusal.
    if (isUniqueViolationOn(err, ONE_ACTIVE_ASSIGNMENT_INDEX)) {
      return coreErr(
        `${user.email} already holds an active assignment for ${tool.name} ` +
          `(created concurrently). Re-read the assignment list and use update_assignment.`,
      );
    }
    throw err;
  }

  return coreOk({ ...preview, assignmentId }, [
    "/assignments",
    `/users/${userId}`,
    `/tools/${toolId}`,
    "/reports",
  ]);
}

export interface RevokeLicenseResult {
  assignmentId: number;
  userEmail: string;
  toolName: string;
  tierName: string;
  monthlyReleasedCents: number;
  assignedAt: string;
}

export async function revokeLicenseCore(
  ctx: WriteContext,
  input: { id: number },
): Promise<CoreResult<RevokeLicenseResult>> {
  const assignment = await db.query.licenseAssignments.findFirst({
    where: eq(licenseAssignments.id, input.id),
    with: {
      user: { columns: { id: true, email: true } },
      tool: { columns: { id: true, name: true } },
      tier: { columns: { id: true, name: true } },
    },
  });
  if (!assignment) return coreErr("Assignment not found");

  const echo = checkUserEmailEcho(ctx, assignment.user.email);
  if (echo) return echo;

  const summary: RevokeLicenseResult = {
    assignmentId: input.id,
    userEmail: assignment.user.email,
    toolName: assignment.tool.name,
    tierName: assignment.tier.name,
    monthlyReleasedCents: assignment.costAtAssignmentCents,
    assignedAt: assignment.assignedAt.toISOString(),
  };

  // Already-revoked is a no-op, not an error: a retry after a lost response on a
  // committed call must not read as failure (that drives the agent toward
  // deactivate_user, which cascades across every license the person holds).
  if (assignment.status !== "active") {
    return coreOk(summary, [], { noop: true });
  }

  // A revoked Copilot seat comes straight back: syncSeatAssignments reactivates
  // any inactive row whose GitHub seat still exists (status -> active,
  // revokedAt -> null, no audit row), so an agent would report a released cost
  // that returns at 06:00. Caps-gated because the UI already withholds this
  // itself — assignments-client hides Revoke on source='copilot-sync' rows — so
  // UI_CAPS keeps exactly today's behavior and nothing in the Hub changes.
  if (!ctx.caps.syncOwnedFields && (await isSyncManagedTool(assignment.tool.name))) {
    return coreErr(SYNC_MANAGED_REVOKE_MESSAGE, { refusedByCaps: true });
  }

  if (!ctx.commit) return coreOk(summary);

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(licenseAssignments)
      .set({ status: "inactive", revokedAt: now, updatedAt: now })
      .where(eq(licenseAssignments.id, input.id));
    await recordStatusChange(
      "license_assignment",
      input.id,
      ctx.actorId,
      "active",
      "inactive",
      { tx, source: ctx.source },
    );
  });

  return coreOk(summary, [
    "/assignments",
    `/users/${assignment.userId}`,
    `/tools/${assignment.toolId}`,
    "/reports",
  ]);
}

export interface UpdateAssignmentResult {
  assignmentId: number;
  userEmail: string;
  changedFields: string[];
  monthlyCostCents: number;
}

export async function updateAssignmentCore(
  ctx: WriteContext,
  input: unknown,
): Promise<CoreResult<UpdateAssignmentResult>> {
  const parsed = updateAssignmentSchema.safeParse(input);
  if (!parsed.success) return coreErr("Validation failed");

  const { id, tierId, assignedAt, workspace, apiKey } = parsed.data;

  if (apiKey !== undefined && !ctx.caps.secrets) {
    return coreErr(MCP_NO_SECRETS_MESSAGE, { refusedByCaps: true });
  }

  const assignment = await db.query.licenseAssignments.findFirst({
    where: eq(licenseAssignments.id, id),
    with: {
      user: { columns: { id: true, email: true } },
      tool: true,
    },
  });
  if (!assignment) return coreErr("Assignment not found");

  const echo = checkUserEmailEcho(ctx, assignment.user.email);
  if (echo) return echo;

  if (assignment.status !== "active") {
    return coreErr("Cannot edit an inactive assignment");
  }

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  const updateValues: Record<string, unknown> = {};
  let warning: string | undefined;
  let newCostCents = assignment.costAtAssignmentCents;

  // --- tierId change (spec 042: shared semantics via buildTierChange) ---
  // The tier is validated even on a same-tier resubmit, which is what the UI
  // detail form does on every save; that matches 042's shipped behavior.
  if (tierId !== undefined) {
    const newTier = await db.query.accessTiers.findFirst({
      where: and(
        eq(accessTiers.id, tierId),
        eq(accessTiers.toolId, assignment.toolId),
        eq(accessTiers.isActive, true),
      ),
    });
    if (!newTier) {
      return coreErr("Tier not found or not available for this tool");
    }

    // Only consult sync authority when the tier actually differs — the detail
    // form always submits tierId, so checking it unconditionally would block
    // workspace/API-key edits on a sync-managed seat.
    const isSyncManaged =
      newTier.id === assignment.tierId
        ? false
        : await isSyncManagedTool(assignment.tool.name);

    const outcome = buildTierChange(
      {
        tierId: assignment.tierId,
        costAtAssignmentCents: assignment.costAtAssignmentCents,
        isSyncManaged,
      },
      { id: newTier.id, monthlyCostCents: newTier.monthlyCostCents },
    );

    // Deliberately NOT gated on ctx.caps.syncOwnedFields: 042 refuses this in
    // the UI too (the detail page disables the tier control and renders a
    // badge), so caps-gating it would hand the UI back an ability that spec
    // shipped to production without. The caps flag covers only the two things
    // the UI CAN still do — the tier price (setTierPriceCore) and revoking a
    // sync-provisioned seat (revokeLicenseCore above).
    if (isTierChangeError(outcome)) return coreErr(outcome.error);

    if (!isTierChangeNoop(outcome)) {
      Object.assign(updateValues, outcome.values);
      Object.assign(changes, outcome.changes);
      newCostCents = outcome.values.costAtAssignmentCents;
    }
  }

  if (assignedAt !== undefined) {
    const newDate = new Date(assignedAt);
    // Guard before any comparison: every comparison against an Invalid Date is
    // false, so an unparseable date would otherwise slip past both checks below
    // and fail opaquely in Drizzle's timestamp serializer.
    if (Number.isNaN(newDate.getTime())) {
      return coreErr("Invalid calendar date");
    }
    const existingDate = assignment.assignedAt;

    if (newDate.getTime() !== existingDate.getTime()) {
      if (newDate > new Date()) {
        return coreErr("Assigned date cannot be in the future");
      }
      if (newDate < assignment.tool.createdAt) {
        return coreErr("Assigned date cannot be before the tool was created");
      }

      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
      if (newDate < twelveMonthsAgo) {
        warning = "Assigned date is more than 12 months in the past";
      }

      changes.assignedAt = {
        old: existingDate.toISOString(),
        new: newDate.toISOString(),
      };
      updateValues.assignedAt = newDate;
    }
  }

  if (apiKey !== undefined) {
    if (apiKey === "") {
      changes.apiKeyEncrypted = { old: "[redacted]", new: null };
      updateValues.apiKeyEncrypted = null;
    } else {
      updateValues.apiKeyEncrypted = await encryptApiKey(apiKey);
      changes.apiKeyEncrypted = { old: "[redacted]", new: "[redacted]" };
    }
  }

  if (workspace !== undefined && workspace !== (assignment.workspace ?? "")) {
    changes.workspace = {
      old: assignment.workspace ?? null,
      new: workspace || null,
    };
    updateValues.workspace = workspace || null;
  }

  const changedFields = Object.keys(changes);
  const result: UpdateAssignmentResult = {
    assignmentId: id,
    userEmail: assignment.user.email,
    changedFields,
    monthlyCostCents: newCostCents,
  };

  if (changedFields.length === 0) {
    return coreOk(result, [], { noop: true });
  }
  if (!ctx.commit) return coreOk(result, [], { warning });

  updateValues.updatedAt = new Date();

  // 042: guard the write on the state we actually read. The predicate covers
  // exactly two races, and it is worth being precise about which:
  //   - status flipped to inactive between the read above and here. Four
  //     producers can do that (revokeLicense, assignLicense's deactivate leg,
  //     deactivateUser's bulk revoke, copilot-sync's removed-seat revoke), and
  //     retiering a just-revoked row would corrupt the historical snapshot that
  //     revoked rows are supposed to preserve.
  //   - tierId already moved, i.e. another admin retiered concurrently.
  //
  // It does NOT protect against a tier PRICE cascade (setTierPriceCore /
  // syncBillingData): those rewrite cost_at_assignment_cents while leaving
  // tier_id alone, so this predicate cannot see them, and our cost value —
  // read before the transaction — would win. Narrow and self-correcting (the
  // next cascade or retier fixes it); a real fix needs row-level
  // compare-and-swap on updatedAt, which the plan scoped out deliberately.
  //
  // 042 (D-F): the update and its audit rows go in ONE transaction. Writing
  // history afterwards means a throw there leaves the tier moved with no record,
  // and the zero-diff early return would then make a retry report success —
  // silently falsifying the audit trail.
  const applied = await db.transaction(async (tx) => {
    const updated = await tx
      .update(licenseAssignments)
      .set(updateValues)
      .where(
        and(
          eq(licenseAssignments.id, id),
          eq(licenseAssignments.status, "active"),
          eq(licenseAssignments.tierId, assignment.tierId),
        ),
      )
      .returning({ id: licenseAssignments.id });

    if (updated.length === 0) return false;

    await recordUpdate("license_assignment", id, ctx.actorId, changes, {
      tx,
      source: ctx.source,
    });
    return true;
  });

  if (!applied) {
    return coreErr(
      "This assignment changed while you were editing it. Refresh and try again.",
    );
  }

  // Only a cost-shaped change justifies busting the budget / report / dashboard
  // caches. That is a tier move (new price snapshot) OR an assignedAt move: the
  // assigned date is the left edge of the seat's held-window, and both
  // overlapsPeriod and the report/budget queries filter on it, so backdating a
  // seat adds its cost to earlier periods. A workspace or API-key edit affects
  // nothing but the assignment's own pages.
  const costChanged = "tierId" in changes || "assignedAt" in changes;

  return coreOk(
    result,
    costChanged
      ? [
          ...assignmentCostPaths(assignment.userId, assignment.toolId),
          `/assignments/${id}`,
        ]
      : ["/assignments", `/users/${assignment.userId}`, `/assignments/${id}`],
    { warning },
  );
}

function checkUserEmailEcho(
  ctx: WriteContext,
  actual: string,
): CoreResult<never> | null {
  const expected = ctx.expect?.userEmail;
  if (expected === undefined) return null;
  if (expected.trim().toLowerCase() === actual.trim().toLowerCase()) return null;
  return coreErr(targetMismatchMessage("expectedUserEmail", expected, actual));
}
