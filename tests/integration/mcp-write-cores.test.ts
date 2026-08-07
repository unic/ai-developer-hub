/**
 * Integration tests for the 043 write cores against the real Neon branch.
 *
 * These exist to cover the class of bug the unit suite structurally cannot: every
 * unit test mocks `@/lib/db`, so Drizzle query shapes, the new partial unique
 * index, `SELECT … FOR UPDATE` (which has no precedent elsewhere in this repo),
 * and the exact shape of a Postgres unique-violation error are all unverified
 * until something runs them.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  accessTiers,
  aiTools,
  changeHistory,
  licenseAssignments,
  users,
} from "@/lib/db/schema";
import { MCP_CAPS, UI_CAPS, type WriteContext } from "@/lib/core/context";
import {
  ONE_ACTIVE_ASSIGNMENT_INDEX,
  assignLicenseCore,
  revokeLicenseCore,
  updateAssignmentCore,
} from "@/lib/core/assignments";
import { isUniqueViolationOn, setTierPriceCore } from "@/lib/core/tools";
import { deactivateUserCore } from "@/lib/core/users";
import {
  COPILOT_SYNC_TOOL_NAME,
  isCopilotSyncActive,
} from "@/lib/assignments/sync-authority";
import { SYNC_MANAGED_TIER_ERROR } from "@/lib/assignments/tier-change";

const SUFFIX = `043-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

let actorId: number;
let viewerId: number;
let adminTargetId: number;
let toolId: number;
let tierAId: number;
let tierBId: number;
const createdAssignmentIds: number[] = [];

function mcpCtx(overrides: Partial<WriteContext> = {}): WriteContext {
  return {
    actorId,
    source: "mcp",
    caps: MCP_CAPS,
    commit: true,
    ...overrides,
  };
}

beforeAll(async () => {
  const [actor] = await db
    .insert(users)
    .values({
      name: `043 Actor ${SUFFIX}`,
      email: `actor-${SUFFIX}@unic.com`,
      passwordHash: "x".repeat(60),
      role: "admin",
      discipline: "developer",
    })
    .returning({ id: users.id });
  actorId = actor.id;

  const [viewer] = await db
    .insert(users)
    .values({
      name: `043 Viewer ${SUFFIX}`,
      email: `viewer-${SUFFIX}@unic.com`,
      passwordHash: "x".repeat(60),
      role: "viewer",
      discipline: "developer",
    })
    .returning({ id: users.id });
  viewerId = viewer.id;

  const [adminTarget] = await db
    .insert(users)
    .values({
      name: `043 AdminTarget ${SUFFIX}`,
      email: `admintarget-${SUFFIX}@unic.com`,
      passwordHash: "x".repeat(60),
      role: "admin",
      discipline: "developer",
    })
    .returning({ id: users.id });
  adminTargetId = adminTarget.id;

  const [tool] = await db
    .insert(aiTools)
    .values({ name: `043 Tool ${SUFFIX}`, vendor: "Test Vendor" })
    .returning({ id: aiTools.id });
  toolId = tool.id;

  const [tierA] = await db
    .insert(accessTiers)
    .values({ toolId, name: "Standard", monthlyCostCents: 1000 })
    .returning({ id: accessTiers.id });
  tierAId = tierA.id;

  const [tierB] = await db
    .insert(accessTiers)
    .values({ toolId, name: "Premium", monthlyCostCents: 2500 })
    .returning({ id: accessTiers.id });
  tierBId = tierB.id;
});

afterAll(async () => {
  const userIds = [actorId, viewerId, adminTargetId].filter(Boolean);
  // change_history FKs users with onDelete: restrict, so audit rows go first.
  if (userIds.length) {
    await db.delete(changeHistory).where(inArray(changeHistory.changedBy, userIds));
  }
  await db.delete(licenseAssignments).where(eq(licenseAssignments.toolId, toolId));
  await db.delete(accessTiers).where(eq(accessTiers.toolId, toolId));
  await db.delete(aiTools).where(eq(aiTools.id, toolId));
  if (userIds.length) {
    await db.delete(users).where(inArray(users.id, userIds));
  }
});

describe("assignLicenseCore against a real DB", () => {
  it("creates an assignment, snapshots the tier price, and audits it as mcp", async () => {
    const result = await assignLicenseCore(mcpCtx(), {
      userId: viewerId,
      toolId,
      tierId: tierAId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    createdAssignmentIds.push(result.data.assignmentId);
    // Cost comes from the tier, never from input.
    expect(result.data.monthlyCostCents).toBe(1000);
    expect(result.data.userEmail).toBe(`viewer-${SUFFIX}@unic.com`);

    const row = await db.query.licenseAssignments.findFirst({
      where: eq(licenseAssignments.id, result.data.assignmentId),
    });
    expect(row?.costAtAssignmentCents).toBe(1000);
    expect(row?.status).toBe("active");
    expect(row?.apiKeyEncrypted).toBeNull();
    expect(row?.source).toBe("mcp");

    const audit = await db.query.changeHistory.findMany({
      where: and(
        eq(changeHistory.entityType, "license_assignment"),
        eq(changeHistory.entityId, result.data.assignmentId),
      ),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].changeType).toBe("created");
    expect(audit[0].changedBy).toBe(actorId);
    expect(audit[0].source).toBe("mcp");
  });

  it("refuses a second active assignment for the same user+tool (MCP caps)", async () => {
    const result = await assignLicenseCore(mcpCtx(), {
      userId: viewerId,
      toolId,
      tierId: tierBId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("already holds active assignment");
    expect(result.refusedByCaps).toBe(true);
  });

  it("refuses an echo mismatch against the real row", async () => {
    const result = await assignLicenseCore(
      mcpCtx({ expect: { userEmail: "someone.else@unic.com" } }),
      { userId: viewerId, toolId, tierId: tierAId },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Target mismatch");
  });

  it("preview mode writes nothing", async () => {
    const before = await db
      .select()
      .from(licenseAssignments)
      .where(eq(licenseAssignments.toolId, toolId));
    const result = await assignLicenseCore(mcpCtx({ commit: false }), {
      userId: adminTargetId,
      toolId,
      tierId: tierAId,
    });
    expect(result.ok).toBe(true);
    const after = await db
      .select()
      .from(licenseAssignments)
      .where(eq(licenseAssignments.toolId, toolId));
    expect(after).toHaveLength(before.length);
  });
});

describe("the partial unique index (migration 0030)", () => {
  it("rejects a duplicate ACTIVE row at the DB level with 23505", async () => {
    // Bypasses the core's pre-check on purpose: the point is to prove the DB
    // enforces the invariant even when an app-level check races.
    let caught: unknown;
    try {
      await db.insert(licenseAssignments).values({
        userId: viewerId,
        toolId,
        tierId: tierAId,
        costAtAssignmentCents: 1000,
        status: "active",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught, "expected the unique index to reject the insert").toBeDefined();
    // Validates the constraint-name extraction that assignLicenseCore relies on
    // to turn a race into the friendly refusal — previously an untested guess.
    expect(isUniqueViolationOn(caught, ONE_ACTIVE_ASSIGNMENT_INDEX)).toBe(true);
  });

  it("permits a second INACTIVE row for the same user+tool", async () => {
    const [row] = await db
      .insert(licenseAssignments)
      .values({
        userId: viewerId,
        toolId,
        tierId: tierAId,
        costAtAssignmentCents: 1000,
        status: "inactive",
        revokedAt: new Date(),
      })
      .returning({ id: licenseAssignments.id });
    expect(row.id).toBeGreaterThan(0);
    await db.delete(licenseAssignments).where(eq(licenseAssignments.id, row.id));
  });
});

describe("updateAssignmentCore against a real DB", () => {
  it("re-snapshots the cost from the new tier", async () => {
    const assignmentId = createdAssignmentIds[0];
    const result = await updateAssignmentCore(
      mcpCtx({ expect: { userEmail: `viewer-${SUFFIX}@unic.com` } }),
      { id: assignmentId, tierId: tierBId },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.monthlyCostCents).toBe(2500);

    const row = await db.query.licenseAssignments.findFirst({
      where: eq(licenseAssignments.id, assignmentId),
    });
    expect(row?.tierId).toBe(tierBId);
    expect(row?.costAtAssignmentCents).toBe(2500);
  });

  it("reports an unchanged edit as a no-op without writing", async () => {
    const assignmentId = createdAssignmentIds[0];
    const result = await updateAssignmentCore(
      mcpCtx({ expect: { userEmail: `viewer-${SUFFIX}@unic.com` } }),
      { id: assignmentId, tierId: tierBId },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.noop).toBe(true);
  });
});

/**
 * The 042 sync-managed refusal, end-to-end through the MCP-reachable core
 * against real production-shaped data (spec 042 + the 043 merge).
 *
 * Deliberately NOT fixtured: `ai_tools_name_idx` is unique on name so a second
 * "GitHub Copilot" row cannot exist, and `isCopilotSyncActive()` reads a real
 * `github_connections` row that a test must not fabricate. So this reads what
 * the branch actually has and skips when it is absent — the load-bearing proof
 * of the refusal is the mocked core-level unit test in
 * tests/unit/actions/assignment-tier-change.test.ts; this only confirms the
 * wiring reaches a real row.
 *
 * Every call runs with `commit: false`: buildTierChange refuses BEFORE the
 * `!ctx.commit` preview return, so the refusal is provable while the test stays
 * write-free against a live Copilot seat.
 */
describe("updateAssignmentCore — sync-managed seats (042)", () => {
  let copilotSeatId: number | undefined;
  let copilotOtherTierId: number | undefined;
  let syncActive = false;

  beforeAll(async () => {
    const copilot = await db.query.aiTools.findFirst({
      where: eq(aiTools.name, COPILOT_SYNC_TOOL_NAME),
      columns: { id: true },
    });
    if (!copilot) return;

    const seat = await db.query.licenseAssignments.findFirst({
      where: and(
        eq(licenseAssignments.toolId, copilot.id),
        eq(licenseAssignments.status, "active"),
      ),
      columns: { id: true, tierId: true },
    });
    if (!seat) return;

    const otherTier = await db.query.accessTiers.findFirst({
      where: and(
        eq(accessTiers.toolId, copilot.id),
        eq(accessTiers.isActive, true),
        ne(accessTiers.id, seat.tierId),
      ),
      columns: { id: true },
    });
    if (!otherTier) return;

    copilotSeatId = seat.id;
    copilotOtherTierId = otherTier.id;
    syncActive = await isCopilotSyncActive();
  });

  // Guarded on syncActive too, not just the rows: the refusal is gated on an
  // ACTIVE github_connections row, so without one a correctly-wired core
  // legitimately returns ok — asserting a refusal there would fail against
  // working code and tempt the next reader to widen the skip until it is a
  // silent no-op.
  it("refuses a retier when Copilot sync is running", async ({ skip }) => {
    if (!copilotSeatId || !copilotOtherTierId || !syncActive) skip();

    const result = await updateAssignmentCore(mcpCtx({ commit: false }), {
      id: copilotSeatId!,
      tierId: copilotOtherTierId!,
    });

    expect(result).toMatchObject({ ok: false, error: SYNC_MANAGED_TIER_ERROR });
  });

  // The companion case: the gate is the CONNECTION, not the tool name. Without
  // an active sync nothing overwrites a manual change, so the core must allow
  // it — this is what fails if someone rewires the core to the pure
  // isSyncManagedToolName predicate.
  it("allows the same retier when Copilot sync is NOT running", async ({ skip }) => {
    if (!copilotSeatId || !copilotOtherTierId || syncActive) skip();

    const result = await updateAssignmentCore(mcpCtx({ commit: false }), {
      id: copilotSeatId!,
      tierId: copilotOtherTierId!,
    });

    expect(result.ok).toBe(true);
  });
});

describe("setTierPriceCore against a real DB", () => {
  it("propagates to active rows, leaves inactive ones, and audits every seat", async () => {
    // tierB currently holds exactly the one active assignment from above.
    const before = await db.query.licenseAssignments.findFirst({
      where: eq(licenseAssignments.id, createdAssignmentIds[0]),
    });
    expect(before?.costAtAssignmentCents).toBe(2500);

    // An inactive row on the same tier must keep its historical snapshot.
    const [stale] = await db
      .insert(licenseAssignments)
      .values({
        userId: adminTargetId,
        toolId,
        tierId: tierBId,
        costAtAssignmentCents: 2500,
        status: "inactive",
        revokedAt: new Date(),
      })
      .returning({ id: licenseAssignments.id });

    const result = await setTierPriceCore(
      mcpCtx({
        expect: {
          toolName: `043 Tool ${SUFFIX}`,
          tierName: "Premium",
          monthlyCostCents: 2500,
        },
      }),
      { tierId: tierBId, monthlyCostCents: 3300 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.activeAssignmentsRepriced).toBe(1);
    expect(result.data.priceBeforeCents).toBe(2500);
    expect(result.data.priceAfterCents).toBe(3300);

    const tier = await db.query.accessTiers.findFirst({
      where: eq(accessTiers.id, tierBId),
    });
    expect(tier?.monthlyCostCents).toBe(3300);

    const active = await db.query.licenseAssignments.findFirst({
      where: eq(licenseAssignments.id, createdAssignmentIds[0]),
    });
    expect(active?.costAtAssignmentCents).toBe(3300);

    const untouched = await db.query.licenseAssignments.findFirst({
      where: eq(licenseAssignments.id, stale.id),
    });
    expect(untouched?.costAtAssignmentCents, "inactive rows keep history").toBe(2500);

    // 1 tier row + 1 per repriced seat — the bulk rewrite used to be silent.
    const tierAudit = await db.query.changeHistory.findMany({
      where: and(
        eq(changeHistory.entityType, "access_tier"),
        eq(changeHistory.entityId, tierBId),
      ),
    });
    expect(tierAudit.some((r) => r.fieldName === "monthlyCostCents")).toBe(true);
    expect(tierAudit.every((r) => r.source === "mcp")).toBe(true);

    const seatAudit = await db.query.changeHistory.findMany({
      where: and(
        eq(changeHistory.entityType, "license_assignment"),
        eq(changeHistory.entityId, createdAssignmentIds[0]),
        eq(changeHistory.fieldName, "costAtAssignmentCents"),
      ),
    });
    expect(seatAudit.length).toBeGreaterThanOrEqual(1);

    await db.delete(licenseAssignments).where(eq(licenseAssignments.id, stale.id));
  });

  it("refuses when the echoed current price is stale (optimistic check)", async () => {
    const result = await setTierPriceCore(
      mcpCtx({ expect: { monthlyCostCents: 2500 } }), // real price is now 3300
      { tierId: tierBId, monthlyCostCents: 4000 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("expectedMonthlyCostCents");
  });

  it("is a no-op when the price is unchanged", async () => {
    const result = await setTierPriceCore(mcpCtx(), {
      tierId: tierBId,
      monthlyCostCents: 3300,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.noop).toBe(true);
  });
});

describe("MCP capability refusals against real rows", () => {
  it("refuses to deactivate an admin target", async () => {
    const result = await deactivateUserCore(mcpCtx(), { id: adminTargetId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusedByCaps).toBe(true);
  });

  it("refuses to target the account the credential is bound to", async () => {
    const result = await deactivateUserCore(mcpCtx(), { id: actorId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusedByCaps).toBe(true);
  });
});

describe("deactivateUserCore cascade against a real DB", () => {
  it("revokes every active license and snapshots each one in the audit trail", async () => {
    const result = await deactivateUserCore(mcpCtx(), { id: viewerId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.revokedCount).toBe(1);
    expect(result.data.monthlyReleasedCents).toBe(3300);

    const user = await db.query.users.findFirst({ where: eq(users.id, viewerId) });
    expect(user?.status).toBe("inactive");

    const assignment = await db.query.licenseAssignments.findFirst({
      where: eq(licenseAssignments.id, createdAssignmentIds[0]),
    });
    expect(assignment?.status).toBe("inactive");
    expect(assignment?.revokedAt).not.toBeNull();

    // The cascade used to write NO audit rows at all. Each now carries a full
    // snapshot, because revokedAt alone cannot tell a reviewer what was held.
    const cascade = await db.query.changeHistory.findMany({
      where: and(
        eq(changeHistory.entityType, "license_assignment"),
        eq(changeHistory.entityId, createdAssignmentIds[0]),
        eq(changeHistory.fieldName, "status"),
      ),
    });
    expect(cascade).toHaveLength(1);
    expect(cascade[0].source).toBe("mcp");
    const snapshot = JSON.parse(cascade[0].previousValue!);
    expect(snapshot.toolName).toBe(`043 Tool ${SUFFIX}`);
    expect(snapshot.costAtAssignmentCents).toBe(3300);

    const userStatus = await db.query.changeHistory.findMany({
      where: and(
        eq(changeHistory.entityType, "user"),
        eq(changeHistory.entityId, viewerId),
      ),
    });
    expect(userStatus.some((r) => r.changeType === "status_change")).toBe(true);
  });

  it("reports an already-inactive user as a no-op, not an error", async () => {
    const result = await deactivateUserCore(mcpCtx(), { id: viewerId });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.noop).toBe(true);
  });
});

describe("revokeLicenseCore no-op path", () => {
  it("treats an already-revoked assignment as a no-op", async () => {
    const result = await revokeLicenseCore(mcpCtx(), {
      id: createdAssignmentIds[0],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.noop).toBe(true);
  });
});

describe("UI caps keep the pre-043 replace semantics", () => {
  it("deactivates-and-replaces an existing active assignment", async () => {
    const [target] = await db
      .insert(users)
      .values({
        name: `043 UI ${SUFFIX}`,
        email: `ui-${SUFFIX}@unic.com`,
        passwordHash: "x".repeat(60),
        role: "viewer",
        discipline: "developer",
      })
      .returning({ id: users.id });

    const first = await assignLicenseCore(
      { actorId, source: "ui", caps: UI_CAPS, commit: true },
      { userId: target.id, toolId, tierId: tierAId },
    );
    expect(first.ok).toBe(true);

    // The UI dialog's retier path: same user+tool, different tier. Must succeed
    // (the minus-1 capacity branch and the replace both stay intact) and must not
    // trip the new partial unique index.
    const second = await assignLicenseCore(
      { actorId, source: "ui", caps: UI_CAPS, commit: true },
      { userId: target.id, toolId, tierId: tierBId },
    );
    expect(second.ok).toBe(true);

    const rows = await db.query.licenseAssignments.findMany({
      where: and(
        eq(licenseAssignments.userId, target.id),
        eq(licenseAssignments.toolId, toolId),
      ),
    });
    expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
    expect(rows).toHaveLength(2);

    await db
      .delete(changeHistory)
      .where(eq(changeHistory.changedBy, actorId));
    await db
      .delete(licenseAssignments)
      .where(eq(licenseAssignments.userId, target.id));
    await db.delete(users).where(eq(users.id, target.id));
  });
});
