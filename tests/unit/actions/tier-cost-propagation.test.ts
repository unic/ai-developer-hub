import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock transitive dependencies that require server-only modules
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The audit writers moved out of @/actions/history (a "use server" file, whose
// exports are client-callable RPC endpoints) into @/lib/history — 043.
vi.mock("@/lib/history", () => ({
  recordCreation: vi.fn(),
  recordUpdate: vi.fn(),
  recordStatusChange: vi.fn(),
  recordDeletion: vi.fn(),
}));
vi.mock("@/lib/copilot-api", () => ({
  fetchCopilotBilling: vi.fn(),
  fetchCopilotSeats: vi.fn(),
  fetchCopilotOrgDayReport: vi.fn(),
  fetchCopilotUsersDayReport: vi.fn(),
  downloadReportNdjson: vi.fn(),
}));

/**
 * `select` and `insert` are new on the tx stub: setTierPriceCore now re-reads the
 * tier price and the affected-seat set under FOR UPDATE inside the transaction,
 * and writes the per-row audit entries through the same tx.
 */
const mockTx = {
  update: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
};

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      accessTiers: { findFirst: vi.fn() },
      aiTools: { findFirst: vi.fn() },
    },
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(mockTx),
    ),
    update: vi.fn(),
    insert: vi.fn(),
    select: vi.fn(),
  },
}));

import { updateTier } from "@/actions/tools";
import { setTierPriceCore, MAX_REPRICE_ROWS } from "@/lib/core/tools";
import { MCP_CAPS } from "@/lib/core/context";
import { syncBillingData } from "@/lib/copilot-sync";
import { requireAdmin } from "@/lib/auth-helpers";
import { recordUpdate } from "@/lib/history";
import { fetchCopilotBilling } from "@/lib/copilot-api";
import { db } from "@/lib/db";
import { accessTiers, licenseAssignments } from "@/lib/db/schema";

/**
 * `vi.clearAllMocks()` clears recorded calls but NOT a pending
 * `mockReturnValueOnce` queue, so a test that errors before consuming everything
 * it queued would hand its leftovers to the next test. Reset the tx stub outright.
 */
beforeEach(() => {
  mockTx.update.mockReset();
  mockTx.insert.mockReset();
  mockTx.select.mockReset();
});

function chainedUpdate() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  return { update: { set }, set, where };
}

/** `db.select(...).from(...).innerJoin(...).where(...)` resolving to `rows`. */
function chainedSelectJoin(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const innerJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ innerJoin, where });
  return { select: { from }, from, innerJoin, where };
}

/** `tx.select(...).from(...).where(...).for("update")` resolving to `rows`. */
function chainedSelectForUpdate(rows: unknown[]) {
  const forFn = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ for: forFn });
  const from = vi.fn().mockReturnValue({ where });
  return { select: { from }, from, where, for: forFn };
}

const existingTier = {
  id: 5,
  toolId: 2,
  name: "Business",
  description: null,
  monthlyCostCents: 0,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  // The cores load the tier WITH its parent tool so they can echo-verify the
  // tool name — tier names are only unique per tool.
  tool: { id: 2, name: "Acme AI" },
};

/** Wire the full happy-path mock chain for a reprice of `seats` active rows. */
function wireReprice(seats: Array<{ id: number; beforeCents: number }>) {
  vi.mocked(db.query.accessTiers.findFirst).mockResolvedValue(
    existingTier as never,
  );
  // Preview read: db.select(...).from(licenseAssignments).innerJoin(users).where()
  vi.mocked(db.select).mockReturnValue(
    chainedSelectJoin(
      seats.map((s) => ({
        assignmentId: s.id,
        userEmail: `u${s.id}@unic.com`,
        beforeCents: s.beforeCents,
      })),
    ).select as never,
  );

  const tierUpdate = chainedUpdate();
  const assignmentUpdate = chainedUpdate();
  mockTx.update
    .mockReturnValueOnce(tierUpdate.update)
    .mockReturnValueOnce(assignmentUpdate.update);

  // In-transaction locking reads: price first, then the seat set.
  mockTx.select
    .mockReturnValueOnce(
      chainedSelectForUpdate([
        { monthlyCostCents: existingTier.monthlyCostCents },
      ]).select,
    )
    .mockReturnValueOnce(chainedSelectForUpdate(seats).select);

  return { tierUpdate, assignmentUpdate };
}

describe("updateTier cost propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({
      id: "1",
      role: "admin",
    } as never);
    vi.mocked(db.query.accessTiers.findFirst).mockResolvedValue(
      existingTier as never,
    );
  });

  it("updates active assignments' cost snapshot when the price changes", async () => {
    const { tierUpdate, assignmentUpdate } = wireReprice([
      { id: 11, beforeCents: 0 },
      { id: 12, beforeCents: 0 },
    ]);

    const result = await updateTier({ id: 5, monthlyCostCents: 1900 });

    expect(result.success).toBe(true);
    expect(mockTx.update).toHaveBeenCalledTimes(2);
    expect(mockTx.update).toHaveBeenNthCalledWith(1, accessTiers);
    expect(mockTx.update).toHaveBeenNthCalledWith(2, licenseAssignments);
    expect(tierUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({ monthlyCostCents: 1900 }),
    );
    expect(assignmentUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({ costAtAssignmentCents: 1900 }),
    );
  });

  it("audits the tier change AND every repriced seat inside the transaction", async () => {
    wireReprice([
      { id: 11, beforeCents: 0 },
      { id: 12, beforeCents: 0 },
    ]);

    await updateTier({ id: 5, monthlyCostCents: 1900 });

    // 1 tier row + 1 per repriced seat. The bulk rewrite was previously silent.
    expect(recordUpdate).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(recordUpdate).mock.calls) {
      // Every audit write must ride the transaction, so it rolls back with the
      // mutation it describes rather than surviving a failed reprice.
      expect(call[4]).toEqual(
        expect.objectContaining({ tx: mockTx, source: "ui" }),
      );
    }
    expect(recordUpdate).toHaveBeenCalledWith(
      "access_tier",
      5,
      1,
      { monthlyCostCents: { old: 0, new: 1900 } },
      expect.anything(),
    );
    expect(recordUpdate).toHaveBeenCalledWith(
      "license_assignment",
      11,
      1,
      { costAtAssignmentCents: { old: 0, new: 1900 } },
      expect.anything(),
    );
  });

  it("derives the audited seat set from the in-transaction locking read", async () => {
    // The preview sees two seats; the locking read inside the tx sees three
    // (one was assigned in between). The audit must describe what was actually
    // rewritten — the locked set — not the stale preview set.
    vi.mocked(db.query.accessTiers.findFirst).mockResolvedValue(
      existingTier as never,
    );
    vi.mocked(db.select).mockReturnValue(
      chainedSelectJoin([
        { assignmentId: 11, userEmail: "a@unic.com", beforeCents: 0 },
        { assignmentId: 12, userEmail: "b@unic.com", beforeCents: 0 },
      ]).select as never,
    );
    mockTx.update
      .mockReturnValueOnce(chainedUpdate().update)
      .mockReturnValueOnce(chainedUpdate().update);
    mockTx.select
      .mockReturnValueOnce(chainedSelectForUpdate([{ monthlyCostCents: 0 }]).select)
      .mockReturnValueOnce(
        chainedSelectForUpdate([
          { id: 11, beforeCents: 0 },
          { id: 12, beforeCents: 0 },
          { id: 13, beforeCents: 0 },
        ]).select,
      );

    await updateTier({ id: 5, monthlyCostCents: 1900 });

    // 1 tier + 3 seats (not 2) — the third seat is audited too.
    expect(recordUpdate).toHaveBeenCalledTimes(4);
    expect(recordUpdate).toHaveBeenCalledWith(
      "license_assignment",
      13,
      1,
      { costAtAssignmentCents: { old: 0, new: 1900 } },
      expect.anything(),
    );
  });

  it("refuses to commit when the price moved after the preview was taken", async () => {
    vi.mocked(db.query.accessTiers.findFirst).mockResolvedValue(
      existingTier as never,
    );
    vi.mocked(db.select).mockReturnValue(chainedSelectJoin([]).select as never);
    // The locked read disagrees with the price the caller planned against.
    mockTx.select.mockReturnValueOnce(
      chainedSelectForUpdate([{ monthlyCostCents: 2500 }]).select,
    );

    const result = await updateTier({ id: 5, monthlyCostCents: 1900 });

    expect(result.success).toBe(false);
    expect(mockTx.update).not.toHaveBeenCalled();
  });

  it("does not touch assignments when only the name changes", async () => {
    const tierUpdate = chainedUpdate();
    mockTx.update.mockReturnValueOnce(tierUpdate.update);
    // updateTier now runs updateTierCore TWICE: a commit:false validation pass
    // before anything is written, then the real commit. That is what stops a
    // metadata failure (duplicate name / deactivating a tier with active
    // assignments) from surfacing AFTER the price and every seat snapshot have
    // already been rewritten. Each pass does tier-lookup then duplicate-check,
    // hence four findFirst calls; only the commit pass writes.
    vi.mocked(db.query.accessTiers.findFirst)
      .mockResolvedValueOnce(existingTier as never)
      .mockResolvedValueOnce(undefined as never)
      .mockResolvedValueOnce(existingTier as never)
      .mockResolvedValueOnce(undefined as never);

    const result = await updateTier({ id: 5, name: "Business Plus" });

    expect(result.success).toBe(true);
    expect(mockTx.update).toHaveBeenCalledTimes(1);
    expect(mockTx.update).toHaveBeenCalledWith(accessTiers);
  });

  it("is a no-op when the price is unchanged", async () => {
    const result = await updateTier({ id: 5, monthlyCostCents: 0 });

    expect(result.success).toBe(true);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(mockTx.update).not.toHaveBeenCalled();
  });

  it("propagates a price of exactly 0 (free tier) rather than skipping it", async () => {
    // Gating propagation on truthiness instead of `!== undefined` would silently
    // skip a legitimate drop to a free tier.
    const pricedTier = { ...existingTier, monthlyCostCents: 1900 };
    vi.mocked(db.query.accessTiers.findFirst).mockResolvedValue(
      pricedTier as never,
    );
    vi.mocked(db.select).mockReturnValue(
      chainedSelectJoin([
        { assignmentId: 11, userEmail: "a@unic.com", beforeCents: 1900 },
      ]).select as never,
    );
    const tierUpdate = chainedUpdate();
    const assignmentUpdate = chainedUpdate();
    mockTx.update
      .mockReturnValueOnce(tierUpdate.update)
      .mockReturnValueOnce(assignmentUpdate.update);
    mockTx.select
      .mockReturnValueOnce(
        chainedSelectForUpdate([{ monthlyCostCents: 1900 }]).select,
      )
      .mockReturnValueOnce(
        chainedSelectForUpdate([{ id: 11, beforeCents: 1900 }]).select,
      );

    const result = await updateTier({ id: 5, monthlyCostCents: 0 });

    expect(result.success).toBe(true);
    expect(assignmentUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({ costAtAssignmentCents: 0 }),
    );
  });
});

describe("setTierPriceCore MCP guardrails", () => {
  const mcpCtx = {
    actorId: 7,
    source: "mcp" as const,
    caps: MCP_CAPS,
    commit: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses a tier whose price the Copilot billing sync owns and would revert", async () => {
    vi.mocked(db.query.accessTiers.findFirst).mockResolvedValue({
      ...existingTier,
      tool: { id: 2, name: "GitHub Copilot" },
    } as never);

    const result = await setTierPriceCore(mcpCtx, {
      tierId: 5,
      monthlyCostCents: 4500,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("GitHub Copilot billing sync");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("allows the same tier for a UI caller, which has always been able to edit it", async () => {
    vi.mocked(db.query.accessTiers.findFirst).mockResolvedValue({
      ...existingTier,
      tool: { id: 2, name: "GitHub Copilot" },
    } as never);
    vi.mocked(db.select).mockReturnValue(chainedSelectJoin([]).select as never);
    mockTx.select
      .mockReturnValueOnce(
        chainedSelectForUpdate([{ monthlyCostCents: 0 }]).select,
      )
      .mockReturnValueOnce(chainedSelectForUpdate([]).select);
    mockTx.update.mockReturnValueOnce(chainedUpdate().update);

    const result = await setTierPriceCore(
      { actorId: 1, source: "ui", caps: { ...MCP_CAPS, syncOwnedFields: true }, commit: true },
      { tierId: 5, monthlyCostCents: 4500 },
    );

    expect(result.ok).toBe(true);
  });

  it("refuses when the echoed tool name does not match the tier's parent tool", async () => {
    vi.mocked(db.query.accessTiers.findFirst).mockResolvedValue(
      existingTier as never,
    );

    const result = await setTierPriceCore(
      { ...mcpCtx, expect: { toolName: "Claude Code", tierName: "Business" } },
      { tierId: 5, monthlyCostCents: 4500 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Acme AI");
      expect(result.error).toContain("expectedToolName");
    }
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("refuses when the echoed current price is stale", async () => {
    vi.mocked(db.query.accessTiers.findFirst).mockResolvedValue(
      existingTier as never,
    );

    const result = await setTierPriceCore(
      { ...mcpCtx, expect: { monthlyCostCents: 1900 } },
      { tierId: 5, monthlyCostCents: 4500 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("expectedMonthlyCostCents");
  });

  it(`refuses a reprice touching more than ${MAX_REPRICE_ROWS} seats`, async () => {
    vi.mocked(db.query.accessTiers.findFirst).mockResolvedValue(
      existingTier as never,
    );
    const tooMany = Array.from({ length: MAX_REPRICE_ROWS + 1 }, (_, i) => ({
      assignmentId: i + 1,
      userEmail: `u${i}@unic.com`,
      beforeCents: 0,
    }));
    vi.mocked(db.select).mockReturnValue(
      chainedSelectJoin(tooMany).select as never,
    );

    const result = await setTierPriceCore(mcpCtx, {
      tierId: 5,
      monthlyCostCents: 1900,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(String(MAX_REPRICE_ROWS));
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("previews without writing anything", async () => {
    vi.mocked(db.query.accessTiers.findFirst).mockResolvedValue(
      existingTier as never,
    );
    vi.mocked(db.select).mockReturnValue(
      chainedSelectJoin([
        { assignmentId: 11, userEmail: "a@unic.com", beforeCents: 0 },
      ]).select as never,
    );

    const result = await setTierPriceCore(
      { ...mcpCtx, commit: false },
      { tierId: 5, monthlyCostCents: 1900 },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.activeAssignmentsRepriced).toBe(1);
      expect(result.data.orgMonthlyAfterCents).toBe(1900);
    }
    expect(db.transaction).not.toHaveBeenCalled();
    expect(recordUpdate).not.toHaveBeenCalled();
  });
});

describe("syncBillingData tier price drift propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchCopilotBilling).mockResolvedValue({
      data: {
        seat_breakdown: { total: 3, active_this_cycle: 2 },
        plan_type: "business",
      },
    } as never);
    vi.mocked(db.query.aiTools.findFirst).mockResolvedValue({
      id: 2,
      name: "GitHub Copilot",
    } as never);
    // db.update for maxLicenses
    vi.mocked(db.update).mockReturnValue(chainedUpdate().update as never);
    // billing snapshot upsert chain
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({ onConflictDoUpdate }),
    } as never);
  });

  it("resyncs active assignments when a tier's synced price differs", async () => {
    // Business tier exists with stale price; Enterprise tier already correct
    vi.mocked(db.query.accessTiers.findFirst)
      .mockResolvedValueOnce({
        id: 5,
        toolId: 2,
        name: "Business",
        monthlyCostCents: 0,
      } as never)
      .mockResolvedValueOnce({
        id: 6,
        toolId: 2,
        name: "Enterprise",
        monthlyCostCents: 3900,
      } as never);

    const tierUpdate = chainedUpdate();
    const assignmentUpdate = chainedUpdate();
    mockTx.update
      .mockReturnValueOnce(tierUpdate.update)
      .mockReturnValueOnce(assignmentUpdate.update);

    await syncBillingData({ id: 1, orgLogin: "acme" }, "token");

    // One transaction for the drifted Business tier, none for Enterprise
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.update).toHaveBeenNthCalledWith(1, accessTiers);
    expect(mockTx.update).toHaveBeenNthCalledWith(2, licenseAssignments);
    expect(tierUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({ monthlyCostCents: 1900 }),
    );
    expect(assignmentUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({ costAtAssignmentCents: 1900 }),
    );
  });

  it("still writes NO change_history rows — the known gap this spec does not close", async () => {
    // Documents that copilot-sync keeps its own copy of the propagation
    // transaction (src/lib/copilot-sync.ts), so an audit query filtered on
    // change_history.source looks complete while omitting the largest automated
    // repricing event in the system. Pointing it at the core is the follow-up.
    vi.mocked(db.query.accessTiers.findFirst)
      .mockResolvedValueOnce({
        id: 5,
        toolId: 2,
        name: "Business",
        monthlyCostCents: 0,
      } as never)
      .mockResolvedValueOnce({
        id: 6,
        toolId: 2,
        name: "Enterprise",
        monthlyCostCents: 3900,
      } as never);
    mockTx.update
      .mockReturnValueOnce(chainedUpdate().update)
      .mockReturnValueOnce(chainedUpdate().update);

    await syncBillingData({ id: 1, orgLogin: "acme" }, "token");

    expect(recordUpdate).not.toHaveBeenCalled();
  });
});
