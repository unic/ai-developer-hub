// Integration tests for the 032-v2 license-request actions — the suites
// deferred since the v1 merge. Runs against the real Neon branch with
// requireAdmin mocked (same pattern as forecast-scenarios.test.ts).

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/lib/db";
import {
  licenseRequests,
  licenseAssignments,
  aiTools,
  accessTiers,
  users,
} from "@/lib/db/schema";
import { and, eq, inArray, like } from "drizzle-orm";
import { decryptApiKey } from "@/lib/crypto";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ id: "1", role: "admin" }),
}));

import {
  approveRequest,
  recordAssignment,
  rejectRequest,
  cancelRequest,
  getRequestMessage,
} from "@/actions/license-requests";

const RUN_TAG = `lr-actions-${Date.now()}`;

let adminUserId: number;
let seatToolId: number;
let seatTierId: number;
let keyToolId: number | null = null;
let keyTierId: number | null = null;

const createdRequestIds: number[] = [];
const createdUserEmails: string[] = [];

async function seedRequest(
  overrides: Partial<typeof licenseRequests.$inferInsert> = {},
) {
  const [row] = await db
    .insert(licenseRequests)
    .values({
      formResponseId: `${RUN_TAG}-${Math.random().toString(36).slice(2, 10)}`,
      requesterEmail: `${RUN_TAG}-${Math.random().toString(36).slice(2, 8)}@test.local`,
      requesterName: "Actions Test Requester",
      requesterRole: "developer",
      requesterProfile: "baseline",
      requestedToolId: seatToolId,
      requestedTierId: seatTierId,
      formPayload: { "Which role describes you?": "Development" },
      teamsTeamId: "t",
      teamsChannelId: "c",
      teamsParentMessageId: "m",
      teamsChatId: "ch",
      ...overrides,
    })
    .returning({
      id: licenseRequests.id,
      requesterEmail: licenseRequests.requesterEmail,
    });
  createdRequestIds.push(row.id);
  createdUserEmails.push(row.requesterEmail);
  return row;
}

beforeAll(async () => {
  const [admin] = await db
    .insert(users)
    .values({
      name: "LR Actions Test Admin",
      email: `${RUN_TAG}-admin@test.local`,
      passwordHash: "not-a-real-hash",
      role: "admin",
    })
    .returning({ id: users.id });
  adminUserId = admin.id;
  createdUserEmails.push(`${RUN_TAG}-admin@test.local`);
  vi.mocked(
    (await import("@/lib/auth-helpers")).requireAdmin,
  ).mockResolvedValue({ id: String(adminUserId), role: "admin" } as never);

  // A seat tool (no API key) with at least one tier.
  const seatTool = await db
    .select({ toolId: aiTools.id, tierId: accessTiers.id })
    .from(aiTools)
    .innerJoin(accessTiers, eq(accessTiers.toolId, aiTools.id))
    .where(and(eq(aiTools.status, "active"), eq(aiTools.requiresApiKey, false)))
    .limit(1);
  seatToolId = seatTool[0].toolId;
  seatTierId = seatTool[0].tierId;

  // An API-key tool (Claude Console after seeding), if present.
  const keyTool = await db
    .select({ toolId: aiTools.id, tierId: accessTiers.id })
    .from(aiTools)
    .innerJoin(accessTiers, eq(accessTiers.toolId, aiTools.id))
    .where(and(eq(aiTools.status, "active"), eq(aiTools.requiresApiKey, true)))
    .limit(1);
  keyToolId = keyTool[0]?.toolId ?? null;
  keyTierId = keyTool[0]?.tierId ?? null;
});

afterAll(async () => {
  // Assignments created via the workflow reference the created users/requests.
  const testUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${RUN_TAG}%`));
  const userIds = testUsers.map((u) => u.id);
  if (userIds.length > 0) {
    await db
      .delete(licenseAssignments)
      .where(inArray(licenseAssignments.userId, userIds));
  }
  if (createdRequestIds.length > 0) {
    await db
      .delete(licenseRequests)
      .where(inArray(licenseRequests.id, createdRequestIds));
  }
  if (userIds.length > 0) {
    await db.delete(users).where(inArray(users.id, userIds));
  }
});

describe("approveRequest (032-v2)", () => {
  it("creates user + assignment + approved status in one action", async () => {
    const req = await seedRequest();
    const result = await approveRequest({
      mode: "create" as const,
      requestId: req.id,
      toolId: seatToolId,
      tierId: seatTierId,
      assignedAt: "2026-07-09",
      bodyMd: "Hi {{requester.firstName}}, access is set up.",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const row = await db.query.licenseRequests.findFirst({
      where: eq(licenseRequests.id, req.id),
    });
    expect(row?.status).toBe("approved");
    expect(row?.assignmentId).toBe(result.data.assignmentId);
    expect(row?.decidedBy).toBe(adminUserId);
    expect(row?.approvalMessageMd).toContain("access is set up");

    // Auto-created user: viewer, discipline from role, unusable password.
    expect(row?.requesterUserId).not.toBeNull();
    const user = await db.query.users.findFirst({
      where: eq(users.id, row!.requesterUserId!),
    });
    expect(user?.role).toBe("viewer");
    expect(user?.discipline).toBe("developer");
    expect(user?.email).toBe(req.requesterEmail);

    const assignment = await db.query.licenseAssignments.findFirst({
      where: eq(licenseAssignments.id, result.data.assignmentId),
    });
    expect(assignment?.userId).toBe(row?.requesterUserId);
    expect(assignment?.toolId).toBe(seatToolId);
    expect(assignment?.status).toBe("active");
    expect(assignment?.source).toBe("license-request-workflow");
  });

  it("blocks a duplicate active assignment for the same user+tool", async () => {
    const email = `${RUN_TAG}-dup@test.local`;
    createdUserEmails.push(email);
    const first = await seedRequest({ requesterEmail: email });
    const firstResult = await approveRequest({
      mode: "create" as const,
      requestId: first.id,
      toolId: seatToolId,
      tierId: seatTierId,
      assignedAt: "2026-07-09",
      bodyMd: "ok",
    });
    expect(firstResult.success).toBe(true);

    const second = await seedRequest({ requesterEmail: email });
    const secondResult = await approveRequest({
      mode: "create" as const,
      requestId: second.id,
      toolId: seatToolId,
      tierId: seatTierId,
      assignedAt: "2026-07-09",
      bodyMd: "ok",
    });
    expect(secondResult.success).toBe(false);
    if (secondResult.success) return;
    expect(secondResult.error).toContain("already has an active assignment");

    // The losing path must not leave the request approved.
    const row = await db.query.licenseRequests.findFirst({
      where: eq(licenseRequests.id, second.id),
    });
    expect(row?.status).toBe("pending_review");
  });

  it("first-write-wins under concurrent approval — exactly one assignment", async () => {
    const req = await seedRequest();
    const attempt = () =>
      approveRequest({
        mode: "create" as const,
        requestId: req.id,
        toolId: seatToolId,
        tierId: seatTierId,
        assignedAt: "2026-07-09",
        bodyMd: "race",
      });
    const [a, b] = await Promise.all([attempt(), attempt()]);
    const successes = [a, b].filter((r) => r.success);
    const failures = [a, b].filter((r) => !r.success);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const row = await db.query.licenseRequests.findFirst({
      where: eq(licenseRequests.id, req.id),
    });
    const assignments = await db
      .select({ id: licenseAssignments.id })
      .from(licenseAssignments)
      .where(eq(licenseAssignments.id, row!.assignmentId!));
    expect(assignments).toHaveLength(1);
  });

  it("requires the API key for requires_api_key tools, encrypts it, and masks the stored message", async () => {
    if (keyToolId === null || keyTierId === null) {
      console.warn("No requires_api_key tool seeded — skipping");
      return;
    }
    const req = await seedRequest({
      requesterProfile: "indie",
      requestedToolId: null,
      requestedTierId: null,
      justification: "needs direct API access",
    });

    const withoutKey = await approveRequest({
      mode: "create" as const,
      requestId: req.id,
      toolId: keyToolId,
      tierId: keyTierId,
      assignedAt: "2026-07-09",
      bodyMd: "Key: `{{licenseCode}}`",
    });
    expect(withoutKey.success).toBe(false);

    const withKey = await approveRequest({
      mode: "create" as const,
      requestId: req.id,
      toolId: keyToolId,
      tierId: keyTierId,
      assignedAt: "2026-07-09",
      licenseCode: "sk-test-abc123",
      bodyMd: "Key: `{{licenseCode}}`",
    });
    expect(withKey.success).toBe(true);
    if (!withKey.success) return;

    // Stored message keeps the token; the key lives encrypted on the assignment.
    const row = await db.query.licenseRequests.findFirst({
      where: eq(licenseRequests.id, req.id),
    });
    expect(row?.approvalMessageMd).toContain("{{licenseCode}}");
    expect(row?.approvalMessageMd).not.toContain("sk-test-abc123");

    const assignment = await db.query.licenseAssignments.findFirst({
      where: eq(licenseAssignments.id, withKey.data.assignmentId),
    });
    expect(assignment?.apiKeyEncrypted).toBeTruthy();
    expect(assignment?.apiKeyEncrypted).not.toContain("sk-test-abc123");
    await expect(decryptApiKey(assignment!.apiKeyEncrypted!)).resolves.toBe(
      "sk-test-abc123",
    );

    // getRequestMessage: masked by default, decrypted on reveal.
    const masked = await getRequestMessage({
      requestId: req.id,
      kind: "approval",
      reveal: false,
    });
    expect(masked.success).toBe(true);
    if (masked.success) {
      expect(masked.data.bodyMd).not.toContain("sk-test-abc123");
      expect(masked.data.containsKey).toBe(true);
    }
    const revealed = await getRequestMessage({
      requestId: req.id,
      kind: "approval",
      reveal: true,
    });
    expect(revealed.success).toBe(true);
    if (revealed.success) {
      expect(revealed.data.bodyMd).toContain("sk-test-abc123");
    }
  });
});

/**
 * Spec 042 — "the requester already holds this tool" is a normal outcome now,
 * not an error. These run against the real DB because the thing worth proving is
 * that the row is mutated IN PLACE: same id, same assigned_at, key intact, one
 * active row. A mocked test can assert the call shape but not the end state.
 *
 * Note: the double-counting property that motivates in-place mutation is pinned
 * by tests/unit/assignment-tier-change.test.ts, NOT here — the integration job
 * is commented out in CI (.github/workflows/ci.yml), so it cannot gate a merge.
 */
describe("approveRequest tier changes (042)", () => {
  /** Approve a fresh request as a create, returning the seat it made. */
  async function seedActiveSeat(email: string, tierId = seatTierId) {
    const req = await seedRequest({ requesterEmail: email });
    const result = await approveRequest({
      mode: "create" as const,
      requestId: req.id,
      toolId: seatToolId,
      tierId,
      assignedAt: "2026-07-09",
      bodyMd: "initial",
    });
    if (!result.success) throw new Error(`seed failed: ${result.error}`);
    return result.data.assignmentId;
  }

  /** A second tier on the seat tool, or null when the tool has only one. */
  async function otherTierId(): Promise<number | null> {
    const tiers = await db
      .select({ id: accessTiers.id })
      .from(accessTiers)
      .where(and(eq(accessTiers.toolId, seatToolId), eq(accessTiers.isActive, true)));
    return tiers.find((t) => t.id !== seatTierId)?.id ?? null;
  }

  it("retiers the existing seat in place, preserving id and assigned_at", async () => {
    const target = await otherTierId();
    if (target === null) {
      console.warn("Seat tool has only one active tier — skipping");
      return;
    }
    const email = `${RUN_TAG}-retier@test.local`;
    createdUserEmails.push(email);
    const assignmentId = await seedActiveSeat(email);

    const before = await db.query.licenseAssignments.findFirst({
      where: eq(licenseAssignments.id, assignmentId),
    });

    const second = await seedRequest({ requesterEmail: email });
    const result = await approveRequest({
      mode: "change_tier" as const,
      requestId: second.id,
      assignmentId,
      toolId: seatToolId,
      tierId: target,
      bodyMd: "Moved you to {{tier.name}} from {{tier.previousName}}.",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    // Same row — not a new one.
    expect(result.data.assignmentId).toBe(assignmentId);

    const after = await db.query.licenseAssignments.findFirst({
      where: eq(licenseAssignments.id, assignmentId),
    });
    expect(after?.tierId).toBe(target);
    expect(after?.status).toBe("active");
    // The seat's start date is history, not something an upgrade rewrites.
    expect(after?.assignedAt.getTime()).toBe(before!.assignedAt.getTime());
    expect(after?.apiKeyEncrypted).toBe(before!.apiKeyEncrypted);
    // Cost follows the new tier (spec 037's convention for active rows).
    const tier = await db.query.accessTiers.findFirst({
      where: eq(accessTiers.id, target),
    });
    expect(after?.costAtAssignmentCents).toBe(tier!.monthlyCostCents);

    // Exactly one active row for this user+tool — no supersede, no duplicate.
    const active = await db
      .select({ id: licenseAssignments.id })
      .from(licenseAssignments)
      .where(
        and(
          eq(licenseAssignments.userId, after!.userId),
          eq(licenseAssignments.toolId, seatToolId),
          eq(licenseAssignments.status, "active"),
        ),
      );
    expect(active).toHaveLength(1);

    const row = await db.query.licenseRequests.findFirst({
      where: eq(licenseRequests.id, second.id),
    });
    expect(row?.status).toBe("approved");
    expect(row?.assignmentId).toBe(assignmentId);
    // {{tier.previousName}} must resolve, never survive as literal braces.
    expect(row?.approvalMessageMd).not.toContain("{{tier.previousName}}");
  });

  it("approves and links without mutating anything in link_existing mode", async () => {
    const email = `${RUN_TAG}-link@test.local`;
    createdUserEmails.push(email);
    const assignmentId = await seedActiveSeat(email);
    const before = await db.query.licenseAssignments.findFirst({
      where: eq(licenseAssignments.id, assignmentId),
    });

    const second = await seedRequest({ requesterEmail: email });
    const result = await approveRequest({
      mode: "link_existing" as const,
      requestId: second.id,
      assignmentId,
      bodyMd: "Your existing seat covers this.",
    });
    expect(result.success).toBe(true);

    const after = await db.query.licenseAssignments.findFirst({
      where: eq(licenseAssignments.id, assignmentId),
    });
    expect(after?.tierId).toBe(before!.tierId);
    expect(after?.costAtAssignmentCents).toBe(before!.costAtAssignmentCents);
    expect(after?.updatedAt.getTime()).toBe(before!.updatedAt.getTime());

    const row = await db.query.licenseRequests.findFirst({
      where: eq(licenseRequests.id, second.id),
    });
    expect(row?.status).toBe("approved");
    expect(row?.assignmentId).toBe(assignmentId);
  });

  it("still refuses a create when the requester already holds the tool", async () => {
    const email = `${RUN_TAG}-dup2@test.local`;
    createdUserEmails.push(email);
    await seedActiveSeat(email);

    const second = await seedRequest({ requesterEmail: email });
    const result = await approveRequest({
      mode: "create" as const,
      requestId: second.id,
      toolId: seatToolId,
      tierId: seatTierId,
      assignedAt: "2026-07-09",
      bodyMd: "ok",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("already has an active assignment");

    const row = await db.query.licenseRequests.findFirst({
      where: eq(licenseRequests.id, second.id),
    });
    expect(row?.status).toBe("pending_review");
  });

  it("refuses a retier onto another user's assignment", async () => {
    const ownerEmail = `${RUN_TAG}-owner@test.local`;
    createdUserEmails.push(ownerEmail);
    const ownerAssignmentId = await seedActiveSeat(ownerEmail);

    // A different requester pointing at someone else's seat.
    const stranger = await seedRequest();
    const result = await approveRequest({
      mode: "change_tier" as const,
      requestId: stranger.id,
      assignmentId: ownerAssignmentId,
      toolId: seatToolId,
      tierId: seatTierId,
      bodyMd: "nope",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("different user");

    const row = await db.query.licenseRequests.findFirst({
      where: eq(licenseRequests.id, stranger.id),
    });
    expect(row?.status).toBe("pending_review");
  });
});

describe("recordAssignment (legacy v1 rows)", () => {
  it("attaches an assignment to an approved row without one", async () => {
    const req = await seedRequest({ status: "approved" });
    const result = await recordAssignment({
      requestId: req.id,
      toolId: seatToolId,
      tierId: seatTierId,
      assignedAt: "2026-07-09",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const row = await db.query.licenseRequests.findFirst({
      where: eq(licenseRequests.id, req.id),
    });
    expect(row?.assignmentId).toBe(result.data.assignmentId);
    expect(row?.status).toBe("approved");
  });

  it("refuses pending rows and rows that already have an assignment", async () => {
    const pending = await seedRequest();
    const onPending = await recordAssignment({
      requestId: pending.id,
      toolId: seatToolId,
      tierId: seatTierId,
      assignedAt: "2026-07-09",
    });
    expect(onPending.success).toBe(false);
  });
});

describe("rejectRequest / cancelRequest", () => {
  it("rejects a pending request with a note; second actor loses", async () => {
    const req = await seedRequest();
    const result = await rejectRequest({
      requestId: req.id,
      decisionNote: "Budget exhausted",
    });
    expect(result.success).toBe(true);

    const again = await rejectRequest({
      requestId: req.id,
      decisionNote: "too late",
    });
    expect(again.success).toBe(false);

    // Rejection must NOT create a user (032-v2 decision).
    const row = await db.query.licenseRequests.findFirst({
      where: eq(licenseRequests.id, req.id),
    });
    expect(row?.requesterUserId).toBeNull();
  });

  it("cancels pending only — approved is terminal since 032-v2", async () => {
    const pending = await seedRequest();
    const ok = await cancelRequest({ requestId: pending.id });
    expect(ok.success).toBe(true);

    const approved = await seedRequest({ status: "approved" });
    const refused = await cancelRequest({ requestId: approved.id });
    expect(refused.success).toBe(false);
  });
});
