import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockDb,
  mockTx,
  mockRequireAdmin,
  mockIsSyncManagedTool,
  mockGetSyncManagedToolId,
  mockRecordUpdate,
} = vi.hoisted(() => {
  const mockTx = {
    query: {
      licenseAssignments: { findFirst: vi.fn() },
      users: { findFirst: vi.fn() },
    },
    insert: vi.fn(),
    update: vi.fn(),
  };
  const mockDb = {
    query: {
      licenseAssignments: { findFirst: vi.fn() },
      accessTiers: { findFirst: vi.fn() },
      aiTools: { findFirst: vi.fn() },
      licenseRequests: { findFirst: vi.fn() },
    },
    transaction: vi.fn(async (cb: (tx: typeof mockTx) => unknown) => cb(mockTx)),
  };
  return {
    mockDb,
    mockTx,
    mockRequireAdmin: vi.fn(),
    mockIsSyncManagedTool: vi.fn(),
    mockGetSyncManagedToolId: vi.fn(),
    mockRecordUpdate: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ requireAdmin: mockRequireAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/actions/history", () => ({
  recordCreation: vi.fn(),
  recordUpdate: mockRecordUpdate,
  recordStatusChange: vi.fn(),
}));
vi.mock("@/lib/assignments/sync-authority", () => ({
  isSyncManagedTool: mockIsSyncManagedTool,
  getSyncManagedToolId: mockGetSyncManagedToolId,
}));
vi.mock("@/lib/crypto", () => ({
  encryptApiKey: vi.fn(async (s: string) => `enc:${s}`),
  decryptApiKey: vi.fn(async (s: string) => s),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { updateAssignment } from "@/actions/assignments";
import { approveRequest } from "@/actions/license-requests";
import { licenseAssignments, licenseRequests } from "@/lib/db/schema";
import { SYNC_MANAGED_TIER_ERROR } from "@/lib/assignments/tier-change";

/**
 * Spec 042. Covers the two real call sites of the shared tier-change rules
 * (buildTierChange is unit-tested directly in tests/unit/assignment-tier-change.test.ts):
 * updateAssignment's in-place retier branch, and approveRequest's mode matrix
 * (create / change_tier / link_existing).
 */

// Chainable tx/db.update(...).set(...).where(...).returning(...) mock, shared by
// updateAssignment's retier write and approveRequest's licenseRequests /
// licenseAssignments writes — all three follow the same shape.
function chainedUpdateReturning(returningValue: unknown[]) {
  const returning = vi.fn().mockResolvedValue(returningValue);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  return { update: { set }, set, where, returning };
}

// tx.insert(users).values(...).onConflictDoNothing().returning(...) — the
// shape ensureRequesterUser needs.
function chainedInsertUsers(returningValue: Array<{ id: number }>) {
  const returning = vi.fn().mockResolvedValue(returningValue);
  const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  return { insert: { values }, values, onConflictDoNothing, returning };
}

const ADMIN = { id: "1", role: "admin" };

function baseAssignment(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    userId: 3,
    toolId: 2,
    tierId: 5,
    status: "active",
    assignedAt: new Date("2026-01-01T00:00:00Z"),
    workspace: null,
    apiKeyEncrypted: null,
    costAtAssignmentCents: 2500,
    revokedAt: null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    tool: { id: 2, createdAt: new Date("2024-01-01T00:00:00Z") },
    user: { id: 3 },
    ...overrides,
  };
}

describe("updateAssignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdmin.mockResolvedValue(ADMIN);
    mockIsSyncManagedTool.mockResolvedValue(false);
  });

  it("non-admin: Unauthorized, and the DB is never touched", async () => {
    mockRequireAdmin.mockResolvedValue(null);

    const result = await updateAssignment({ id: 100, tierId: 5 });

    expect(result).toEqual({ success: false, error: "Unauthorized" });
    expect(mockDb.query.licenseAssignments.findFirst).not.toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("inactive assignment: refuses the edit", async () => {
    mockDb.query.licenseAssignments.findFirst.mockResolvedValue(
      baseAssignment({ status: "inactive" }),
    );

    const result = await updateAssignment({ id: 100, tierId: 5 });

    expect(result).toEqual({
      success: false,
      error: "Cannot edit an inactive assignment",
    });
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("tierId from a different tool (or inactive): 'Tier not found or not available for this tool'", async () => {
    mockDb.query.licenseAssignments.findFirst.mockResolvedValue(baseAssignment());
    // The toolId + isActive predicates are baked into the query itself; a tier
    // that fails either comes back as undefined, same as "doesn't exist".
    mockDb.query.accessTiers.findFirst.mockResolvedValue(undefined);

    const result = await updateAssignment({ id: 100, tierId: 999 });

    expect(result).toEqual({
      success: false,
      error: "Tier not found or not available for this tool",
    });
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("current tierId resubmitted with no other changes: success, no update, no history write", async () => {
    mockDb.query.licenseAssignments.findFirst.mockResolvedValue(baseAssignment());
    mockDb.query.accessTiers.findFirst.mockResolvedValue({
      id: 5,
      toolId: 2,
      isActive: true,
      monthlyCostCents: 2500,
    });

    const result = await updateAssignment({ id: 100, tierId: 5 });

    expect(result).toEqual({ success: true, data: undefined });
    // Same tier short-circuits before the sync-authority check even runs.
    expect(mockIsSyncManagedTool).not.toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockRecordUpdate).not.toHaveBeenCalled();
  });

  it("a real tier change on a sync-managed tool: refused with SYNC_MANAGED_TIER_ERROR", async () => {
    mockDb.query.licenseAssignments.findFirst.mockResolvedValue(baseAssignment());
    mockDb.query.accessTiers.findFirst.mockResolvedValue({
      id: 6,
      toolId: 2,
      isActive: true,
      monthlyCostCents: 5000,
    });
    mockIsSyncManagedTool.mockResolvedValue(true);

    const result = await updateAssignment({ id: 100, tierId: 6 });

    expect(result).toEqual({ success: false, error: SYNC_MANAGED_TIER_ERROR });
    expect(mockIsSyncManagedTool).toHaveBeenCalledWith(2);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  /**
   * Regression guard: the detail form always submits tierId, even when the
   * admin only meant to edit workspace/API key. If the sync-managed check ran
   * unconditionally (rather than only when the tier actually differs), this
   * would be wrongly refused too.
   */
  it("same tierId + a workspace change on a sync-managed tool: succeeds", async () => {
    mockDb.query.licenseAssignments.findFirst.mockResolvedValue(baseAssignment());
    mockDb.query.accessTiers.findFirst.mockResolvedValue({
      id: 5,
      toolId: 2,
      isActive: true,
      monthlyCostCents: 2500,
    });
    // Prove the short-circuit, not just its effect: even a tool the sync
    // authority would otherwise refuse must never be consulted here.
    mockIsSyncManagedTool.mockResolvedValue(true);
    mockTx.update.mockReturnValueOnce(chainedUpdateReturning([{ id: 100 }]).update);

    const result = await updateAssignment({
      id: 100,
      tierId: 5,
      workspace: "new-workspace",
    });

    expect(result).toEqual({ success: true, data: undefined });
    expect(mockIsSyncManagedTool).not.toHaveBeenCalled();
    expect(mockTx.update).toHaveBeenCalledWith(licenseAssignments);
    expect(mockRecordUpdate).toHaveBeenCalledWith(
      "license_assignment",
      100,
      1,
      expect.objectContaining({ workspace: { old: null, new: "new-workspace" } }),
      mockTx,
    );
  });

  it("race guard: a zero-row conditional UPDATE reports the changed-while-editing error, not success", async () => {
    mockDb.query.licenseAssignments.findFirst.mockResolvedValue(baseAssignment());
    mockDb.query.accessTiers.findFirst.mockResolvedValue({
      id: 6,
      toolId: 2,
      isActive: true,
      monthlyCostCents: 5000,
    });
    mockIsSyncManagedTool.mockResolvedValue(false);
    // The row moved out from under the WHERE predicate — returning() yields [].
    mockTx.update.mockReturnValueOnce(chainedUpdateReturning([]).update);

    const result = await updateAssignment({ id: 100, tierId: 6 });

    expect(result).toEqual({
      success: false,
      error:
        "This assignment changed while you were editing it. Refresh and try again.",
    });
    expect(mockRecordUpdate).not.toHaveBeenCalled();
  });
});

describe("approveRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdmin.mockResolvedValue(ADMIN);
    mockIsSyncManagedTool.mockResolvedValue(false);
  });

  function baseRequest(overrides: Record<string, unknown> = {}) {
    return {
      id: 50,
      status: "pending_review",
      requesterUserId: null,
      requesterEmail: "alice@example.com",
      requesterName: "Alice",
      requesterRole: "developer",
      requesterProfile: "baseline",
      ...overrides,
    };
  }

  function activeTargetAssignment(overrides: Record<string, unknown> = {}) {
    return {
      id: 10,
      userId: 3,
      toolId: 2,
      tierId: 5,
      costAtAssignmentCents: 2500,
      status: "active",
      user: { id: 3, email: "alice@example.com" },
      ...overrides,
    };
  }

  it("mode create: duplicate active assignment throws (not returns), so the transaction rolls back", async () => {
    mockDb.query.licenseRequests.findFirst.mockResolvedValue(baseRequest());
    mockDb.query.aiTools.findFirst.mockResolvedValue({
      id: 2,
      name: "Claude Console",
      requiresApiKey: false,
    });
    mockDb.query.accessTiers.findFirst.mockResolvedValue({
      id: 5,
      name: "Standard",
      toolId: 2,
      isActive: true,
      monthlyCostCents: 2500,
    });

    // ensureRequesterUser: no existing hub user, so it inserts one.
    mockTx.query.users.findFirst.mockResolvedValue(undefined);
    mockTx.insert.mockReturnValueOnce(chainedInsertUsers([{ id: 77 }]).insert);
    // createAssignmentInTx's duplicate-seat check finds an existing active seat.
    mockTx.query.licenseAssignments.findFirst.mockResolvedValue({ id: 42 });

    // Capture whatever the transaction callback itself does, independent of
    // approveRequest's own .catch() — this is the only way to prove the
    // rejection reached db.transaction (and would trigger a real ROLLBACK)
    // rather than the duplicate-seat check merely `return`ing an error object.
    let callbackRejection: unknown;
    mockDb.transaction.mockImplementationOnce(
      async (cb: (tx: typeof mockTx) => unknown) => {
        try {
          return await cb(mockTx);
        } catch (err) {
          callbackRejection = err;
          throw err;
        }
      },
    );

    const result = await approveRequest({
      mode: "create",
      requestId: 50,
      toolId: 2,
      tierId: 5,
      assignedAt: "2026-01-01",
      bodyMd: "Approved",
    });

    expect(callbackRejection).toBeInstanceOf(Error);
    expect((callbackRejection as Error).message).toMatch(
      /already has an active assignment/,
    );
    // The auto-created user insert ran BEFORE the throw — this is exactly the
    // write that a `return` (instead of `throw`) used to leave committed.
    expect(mockTx.insert).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: false,
      error: expect.stringContaining("already has an active assignment"),
    });
  });

  it("mode change_tier on a sync-managed tool: refused before any transaction runs", async () => {
    mockDb.query.licenseRequests.findFirst.mockResolvedValue(baseRequest());
    mockDb.query.aiTools.findFirst.mockResolvedValue({
      id: 2,
      name: "GitHub Copilot",
      requiresApiKey: false,
    });
    mockDb.query.accessTiers.findFirst.mockResolvedValue({
      id: 6,
      name: "Business",
      toolId: 2,
      isActive: true,
      monthlyCostCents: 5000,
    });
    mockIsSyncManagedTool.mockResolvedValue(true);

    const result = await approveRequest({
      mode: "change_tier",
      requestId: 50,
      assignmentId: 10,
      toolId: 2,
      tierId: 6,
      bodyMd: "Approved",
    });

    expect(result).toEqual({ success: false, error: SYNC_MANAGED_TIER_ERROR });
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("mode change_tier where the target assignment is not active: refused", async () => {
    mockDb.query.licenseRequests.findFirst.mockResolvedValue(baseRequest());
    mockDb.query.aiTools.findFirst.mockResolvedValue({
      id: 2,
      name: "Claude Console",
      requiresApiKey: false,
    });
    mockDb.query.accessTiers.findFirst.mockResolvedValue({
      id: 6,
      name: "Premium",
      toolId: 2,
      isActive: true,
      monthlyCostCents: 5000,
    });
    mockTx.query.licenseAssignments.findFirst.mockResolvedValue(
      activeTargetAssignment({ status: "inactive" }),
    );

    const result = await approveRequest({
      mode: "change_tier",
      requestId: 50,
      assignmentId: 10,
      toolId: 2,
      tierId: 6,
      bodyMd: "Approved",
    });

    expect(result).toEqual({
      success: false,
      error: expect.stringContaining("no longer active"),
    });
  });

  it("mode change_tier where the target assignment belongs to a different user: refused", async () => {
    mockDb.query.licenseRequests.findFirst.mockResolvedValue(baseRequest());
    mockDb.query.aiTools.findFirst.mockResolvedValue({
      id: 2,
      name: "Claude Console",
      requiresApiKey: false,
    });
    mockDb.query.accessTiers.findFirst.mockResolvedValue({
      id: 6,
      name: "Premium",
      toolId: 2,
      isActive: true,
      monthlyCostCents: 5000,
    });
    mockTx.query.licenseAssignments.findFirst.mockResolvedValue(
      activeTargetAssignment({
        userId: 99,
        user: { id: 99, email: "bob@example.com" },
      }),
    );

    const result = await approveRequest({
      mode: "change_tier",
      requestId: 50,
      assignmentId: 10,
      toolId: 2,
      tierId: 6,
      bodyMd: "Approved",
    });

    expect(result).toEqual({
      success: false,
      error: expect.stringContaining("different user"),
    });
  });

  /**
   * Regression guard: a naive copy of updateAssignment's zero-diff early
   * return would leave the request stuck in pending_review whenever the
   * approver picks the tier the seat already has. Approval must still land —
   * only the retier write to license_assignments is skipped.
   */
  it("mode change_tier with the tier the seat already has: still approves and links; licenseRequests UPDATE still runs", async () => {
    mockDb.query.licenseRequests.findFirst.mockResolvedValue(baseRequest());
    mockDb.query.aiTools.findFirst.mockResolvedValue({
      id: 2,
      name: "Claude Console",
      requiresApiKey: false,
    });
    mockDb.query.accessTiers.findFirst.mockResolvedValue({
      id: 5,
      name: "Standard",
      toolId: 2,
      isActive: true,
      monthlyCostCents: 2500,
    });
    mockTx.query.licenseAssignments.findFirst.mockResolvedValue(
      activeTargetAssignment({ tierId: 5, costAtAssignmentCents: 2500 }),
    );
    mockTx.update.mockReturnValueOnce(
      chainedUpdateReturning([{ id: 50 }]).update,
    );

    const result = await approveRequest({
      mode: "change_tier",
      requestId: 50,
      assignmentId: 10,
      toolId: 2,
      tierId: 5,
      bodyMd: "Approved",
    });

    expect(result).toEqual({
      success: true,
      data: { requestId: 50, assignmentId: 10 },
    });
    // Exactly one update in the transaction — licenseRequests — and it is NOT
    // the (skipped) licenseAssignments retier.
    expect(mockTx.update).toHaveBeenCalledTimes(1);
    expect(mockTx.update).toHaveBeenCalledWith(licenseRequests);
    expect(mockRecordUpdate).not.toHaveBeenCalled();
  });

  it("mode link_existing: approves and links, with NO update to license_assignments", async () => {
    mockDb.query.licenseRequests.findFirst.mockResolvedValue(baseRequest());
    mockTx.query.licenseAssignments.findFirst.mockResolvedValue(
      activeTargetAssignment(),
    );
    mockTx.update.mockReturnValueOnce(
      chainedUpdateReturning([{ id: 50 }]).update,
    );

    const result = await approveRequest({
      mode: "link_existing",
      requestId: 50,
      assignmentId: 10,
      bodyMd: "Approved",
    });

    expect(result).toEqual({
      success: true,
      data: { requestId: 50, assignmentId: 10 },
    });
    expect(mockTx.update).toHaveBeenCalledTimes(1);
    expect(mockTx.update).toHaveBeenCalledWith(licenseRequests);
    expect(mockTx.update).not.toHaveBeenCalledWith(licenseAssignments);
  });

  it("a request not in pending_review: 'Cannot approve a request in status \"...\"'", async () => {
    mockDb.query.licenseRequests.findFirst.mockResolvedValue(
      baseRequest({ status: "approved" }),
    );

    const result = await approveRequest({
      mode: "link_existing",
      requestId: 50,
      assignmentId: 10,
      bodyMd: "Approved",
    });

    expect(result).toEqual({
      success: false,
      error: 'Cannot approve a request in status "approved".',
    });
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });
});
