import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/lib/db";
import {
  annualBudgets,
  budgetPeriods,
  budgetExtensions,
  budgetExtensionPeriodAllocations,
  changeHistory,
  users,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ id: "1", role: "admin" }),
}));

import {
  createBudgetExtension,
  deleteBudgetExtension,
  updateBudgetExtension,
} from "@/actions/budget-extensions";

let adminUserId: number;
let activeBudgetId: number;
let archivedBudgetId: number;
let periodIds: number[] = []; // 12 monthly periods of the active budget
let archivedPeriodId: number;

// Use 4-digit FY years far in the future so the lex-prefix check is
// unambiguous, we don't collide with real data, and they're inside the
// effectiveDate regex (which expects YYYY-MM-DD).
const ACTIVE_FY = 2090 + Math.floor(Math.random() * 9);
const ARCHIVED_FY = ACTIVE_FY - 10;

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      name: "Budget Extension Test Admin",
      email: `ext-test-${Date.now()}@test.local`,
      passwordHash: "not-a-real-hash",
      role: "admin",
    })
    .returning({ id: users.id });
  adminUserId = user.id;
  vi.mocked(
    (await import("@/lib/auth-helpers")).requireAdmin
  ).mockResolvedValue({ id: String(adminUserId), role: "admin" } as never);

  const [active] = await db
    .insert(annualBudgets)
    .values({
      fiscalYear: ACTIVE_FY,
      totalAmountCents: 1_200_000, // 12,000 EUR baseline
      originalAmountCents: 1_200_000,
      periodType: "monthly",
      status: "active",
    })
    .returning({ id: annualBudgets.id });
  activeBudgetId = active.id;

  const [archived] = await db
    .insert(annualBudgets)
    .values({
      fiscalYear: ARCHIVED_FY,
      totalAmountCents: 1_000_000,
      originalAmountCents: 1_000_000,
      periodType: "monthly",
      status: "archived",
    })
    .returning({ id: annualBudgets.id });
  archivedBudgetId = archived.id;

  // 12 monthly periods, 100,000c each (sums to 1.2M = the ceiling)
  const months: { idx: number; label: string; start: string; end: string }[] = [
    { idx: 0, label: "Jan", start: `${ACTIVE_FY}-01-01`, end: `${ACTIVE_FY}-01-31` },
    { idx: 1, label: "Feb", start: `${ACTIVE_FY}-02-01`, end: `${ACTIVE_FY}-02-28` },
    { idx: 2, label: "Mar", start: `${ACTIVE_FY}-03-01`, end: `${ACTIVE_FY}-03-31` },
    { idx: 3, label: "Apr", start: `${ACTIVE_FY}-04-01`, end: `${ACTIVE_FY}-04-30` },
    { idx: 4, label: "May", start: `${ACTIVE_FY}-05-01`, end: `${ACTIVE_FY}-05-31` },
    { idx: 5, label: "Jun", start: `${ACTIVE_FY}-06-01`, end: `${ACTIVE_FY}-06-30` },
    { idx: 6, label: "Jul", start: `${ACTIVE_FY}-07-01`, end: `${ACTIVE_FY}-07-31` },
    { idx: 7, label: "Aug", start: `${ACTIVE_FY}-08-01`, end: `${ACTIVE_FY}-08-31` },
    { idx: 8, label: "Sep", start: `${ACTIVE_FY}-09-01`, end: `${ACTIVE_FY}-09-30` },
    { idx: 9, label: "Oct", start: `${ACTIVE_FY}-10-01`, end: `${ACTIVE_FY}-10-31` },
    { idx: 10, label: "Nov", start: `${ACTIVE_FY}-11-01`, end: `${ACTIVE_FY}-11-30` },
    { idx: 11, label: "Dec", start: `${ACTIVE_FY}-12-01`, end: `${ACTIVE_FY}-12-31` },
  ];

  for (const m of months) {
    const [row] = await db
      .insert(budgetPeriods)
      .values({
        budgetId: activeBudgetId,
        periodLabel: `${m.label} ${ACTIVE_FY}`,
        periodIndex: m.idx,
        startDate: m.start,
        endDate: m.end,
        plannedAmountCents: 100_000,
      })
      .returning({ id: budgetPeriods.id });
    periodIds.push(row.id);
  }

  const [archivedPeriod] = await db
    .insert(budgetPeriods)
    .values({
      budgetId: archivedBudgetId,
      periodLabel: `Jan ${ARCHIVED_FY}`,
      periodIndex: 0,
      startDate: `${ARCHIVED_FY}-01-01`,
      endDate: `${ARCHIVED_FY}-01-31`,
      plannedAmountCents: 50_000,
    })
    .returning({ id: budgetPeriods.id });
  archivedPeriodId = archivedPeriod.id;
});

afterAll(async () => {
  // Cascade deletes will clean up periods, extensions, allocations
  await db.delete(annualBudgets).where(eq(annualBudgets.id, activeBudgetId));
  await db.delete(annualBudgets).where(eq(annualBudgets.id, archivedBudgetId));
  await db
    .delete(changeHistory)
    .where(eq(changeHistory.changedBy, adminUserId));
  await db.delete(users).where(eq(users.id, adminUserId));
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("createBudgetExtension", () => {
  it("bumps the ceiling and leaves periods untouched when allocation=unallocated", async () => {
    const result = await createBudgetExtension({
      budgetId: activeBudgetId,
      amountCents: 200_000,
      reason: "Unallocated headroom test",
      category: "other",
      effectiveDate: `${ACTIVE_FY}-05-15`,
      allocation: { mode: "unallocated" },
    });
    expect(result.success).toBe(true);

    const refreshed = await db.query.annualBudgets.findFirst({
      where: eq(annualBudgets.id, activeBudgetId),
    });
    expect(refreshed?.totalAmountCents).toBe(1_400_000);
    // Baseline immutable
    expect(refreshed?.originalAmountCents).toBe(1_200_000);

    // Periods unchanged
    const periods = await db.query.budgetPeriods.findMany({
      where: eq(budgetPeriods.budgetId, activeBudgetId),
    });
    for (const p of periods) expect(p.plannedAmountCents).toBe(100_000);

    // No allocation rows for this extension
    if (result.success) {
      const allocs = await db.query.budgetExtensionPeriodAllocations.findMany({
        where: eq(budgetExtensionPeriodAllocations.extensionId, result.data.id),
      });
      expect(allocs.length).toBe(0);

      // Cleanup so subsequent tests start from the post-creation state
      await deleteBudgetExtension({ extensionId: result.data.id });
    }
  });

  it("distributes across remaining periods (>= effective date)", async () => {
    const result = await createBudgetExtension({
      budgetId: activeBudgetId,
      amountCents: 80_000,
      reason: "Distribute remaining test",
      category: "scope_increase",
      effectiveDate: `${ACTIVE_FY}-09-01`, // remaining = Sep, Oct, Nov, Dec (4 periods)
      allocation: { mode: "distribute_remaining" },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    // 80,000 / 4 = 20,000 per period
    const allocs = await db.query.budgetExtensionPeriodAllocations.findMany({
      where: eq(budgetExtensionPeriodAllocations.extensionId, result.data.id),
    });
    expect(allocs.length).toBe(4);
    const sum = allocs.reduce((s, a) => s + a.amountCents, 0);
    expect(sum).toBe(80_000);

    // Verify period totals
    const periods = await db.query.budgetPeriods.findMany({
      where: eq(budgetPeriods.budgetId, activeBudgetId),
      orderBy: (p, { asc }) => [asc(p.periodIndex)],
    });
    // First 8 periods unchanged at 100k
    for (let i = 0; i < 8; i++) expect(periods[i].plannedAmountCents).toBe(100_000);
    // Last 4 bumped by 20k each
    for (let i = 8; i < 12; i++) expect(periods[i].plannedAmountCents).toBe(120_000);

    await deleteBudgetExtension({ extensionId: result.data.id });
  });

  it("allocates the full delta to a single period", async () => {
    const target = periodIds[5]; // Jun
    const result = await createBudgetExtension({
      budgetId: activeBudgetId,
      amountCents: 30_000,
      reason: "Single-period allocation test",
      category: "vendor_price_increase",
      effectiveDate: `${ACTIVE_FY}-06-01`,
      allocation: { mode: "single_period", periodId: target },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const allocs = await db.query.budgetExtensionPeriodAllocations.findMany({
      where: eq(budgetExtensionPeriodAllocations.extensionId, result.data.id),
    });
    expect(allocs.length).toBe(1);
    expect(allocs[0].periodId).toBe(target);
    expect(allocs[0].amountCents).toBe(30_000);

    await deleteBudgetExtension({ extensionId: result.data.id });
  });

  it("refuses extension on an archived budget", async () => {
    const result = await createBudgetExtension({
      budgetId: archivedBudgetId,
      amountCents: 10_000,
      reason: "Should fail — archived",
      category: "other",
      effectiveDate: `${ARCHIVED_FY}-01-15`,
      allocation: { mode: "unallocated" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/archived/i);
    }
  });

  it("refuses an effective date outside the fiscal year", async () => {
    const result = await createBudgetExtension({
      budgetId: activeBudgetId,
      amountCents: 10_000,
      reason: "Should fail — wrong year",
      category: "other",
      effectiveDate: `${ACTIVE_FY - 1}-12-31`,
      allocation: { mode: "unallocated" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/fiscal year/i);
    }
  });

  it("refuses when per-period allocations would exceed the new ceiling", async () => {
    // Periods sum to 1.2M (= current ceiling). A +0 extension can't happen
    // (CHECK constraint). A reduction that drops the ceiling below the
    // existing planned-sum without touching periods should fail.
    const result = await createBudgetExtension({
      budgetId: activeBudgetId,
      amountCents: -500_000,
      reason: "Reduction that under-funds allocations",
      category: "reallocation",
      effectiveDate: `${ACTIVE_FY}-06-15`,
      allocation: { mode: "unallocated" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/exceed/i);
    }
  });

  it("records a change_history row with entityType=budget_extension", async () => {
    const result = await createBudgetExtension({
      budgetId: activeBudgetId,
      amountCents: 5_000,
      reason: "History audit test",
      category: "other",
      effectiveDate: `${ACTIVE_FY}-05-15`,
      allocation: { mode: "unallocated" },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const rows = await db.query.changeHistory.findMany({
      where: and(
        eq(changeHistory.entityType, "budget_extension"),
        eq(changeHistory.entityId, result.data.id)
      ),
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].changeType).toBe("created");

    await deleteBudgetExtension({ extensionId: result.data.id });
  });
});

describe("deleteBudgetExtension", () => {
  it("reverses the ceiling and period allocations", async () => {
    const created = await createBudgetExtension({
      budgetId: activeBudgetId,
      amountCents: 60_000,
      reason: "Delete reversal test",
      category: "new_tool",
      effectiveDate: `${ACTIVE_FY}-10-01`, // last 3 periods
      allocation: { mode: "distribute_remaining" },
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    // Sanity: ceiling bumped, last 3 periods bumped 20k each
    let budget = await db.query.annualBudgets.findFirst({
      where: eq(annualBudgets.id, activeBudgetId),
    });
    expect(budget?.totalAmountCents).toBe(1_260_000);

    const delResult = await deleteBudgetExtension({
      extensionId: created.data.id,
    });
    expect(delResult.success).toBe(true);

    budget = await db.query.annualBudgets.findFirst({
      where: eq(annualBudgets.id, activeBudgetId),
    });
    expect(budget?.totalAmountCents).toBe(1_200_000);

    const periods = await db.query.budgetPeriods.findMany({
      where: eq(budgetPeriods.budgetId, activeBudgetId),
    });
    for (const p of periods) expect(p.plannedAmountCents).toBe(100_000);
  });

  it("cascade-deletes the allocation rows", async () => {
    const created = await createBudgetExtension({
      budgetId: activeBudgetId,
      amountCents: 10_000,
      reason: "Cascade delete test",
      category: "other",
      effectiveDate: `${ACTIVE_FY}-07-15`,
      allocation: {
        mode: "single_period",
        periodId: periodIds[6],
      },
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    await deleteBudgetExtension({ extensionId: created.data.id });

    const allocs = await db.query.budgetExtensionPeriodAllocations.findMany({
      where: eq(
        budgetExtensionPeriodAllocations.extensionId,
        created.data.id
      ),
    });
    expect(allocs.length).toBe(0);

    const ext = await db.query.budgetExtensions.findFirst({
      where: eq(budgetExtensions.id, created.data.id),
    });
    expect(ext).toBeUndefined();
  });

  it("records a change_history row with changeType=deleted and a previousValue snapshot", async () => {
    const created = await createBudgetExtension({
      budgetId: activeBudgetId,
      amountCents: 12_000,
      reason: "History snapshot test",
      category: "other",
      effectiveDate: `${ACTIVE_FY}-09-15`,
      allocation: {
        mode: "single_period",
        periodId: periodIds[8],
      },
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const delResult = await deleteBudgetExtension({
      extensionId: created.data.id,
    });
    expect(delResult.success).toBe(true);

    const rows = await db.query.changeHistory.findMany({
      where: and(
        eq(changeHistory.entityType, "budget_extension"),
        eq(changeHistory.entityId, created.data.id)
      ),
    });
    const deletedRow = rows.find((r) => r.changeType === "deleted");
    expect(deletedRow).toBeDefined();
    if (!deletedRow) return;
    expect(deletedRow.previousValue).toBeTruthy();
    const snapshot = JSON.parse(deletedRow.previousValue ?? "null");
    expect(snapshot.amountCents).toBe(12_000);
    expect(snapshot.reason).toBe("History snapshot test");
    expect(snapshot.allocations).toHaveLength(1);
    expect(snapshot.allocations[0].periodId).toBe(periodIds[8]);
    expect(snapshot.allocations[0].amountCents).toBe(12_000);
  });
});

describe("updateBudgetExtension", () => {
  it("updates reason and category but not amount", async () => {
    const created = await createBudgetExtension({
      budgetId: activeBudgetId,
      amountCents: 15_000,
      reason: "Original reason",
      category: "other",
      effectiveDate: `${ACTIVE_FY}-08-15`,
      allocation: { mode: "unallocated" },
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const result = await updateBudgetExtension({
      extensionId: created.data.id,
      reason: "Updated reason",
      category: "seat_increase",
    });
    expect(result.success).toBe(true);

    const refreshed = await db.query.budgetExtensions.findFirst({
      where: eq(budgetExtensions.id, created.data.id),
    });
    expect(refreshed?.reason).toBe("Updated reason");
    expect(refreshed?.category).toBe("seat_increase");
    // Amount is unchanged (not editable through this action)
    expect(refreshed?.amountCents).toBe(15_000);

    await deleteBudgetExtension({ extensionId: created.data.id });
  });
});
