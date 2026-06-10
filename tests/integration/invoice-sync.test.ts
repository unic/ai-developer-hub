import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/lib/db";
import {
  annualBudgets,
  budgetPeriods,
  billedCosts,
  invoices,
  users,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { SyncResult } from "@/types";

// ── Mock server-only modules that are unavailable outside Next.js ────────────

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ id: "1", role: "admin" }),
}));

vi.mock("@/actions/history", () => ({
  recordCreation: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocks
import { syncInvoices } from "@/actions/invoice-sync";

// ── Seeded IDs (populated in beforeAll) ──────────────────────────────────────

let adminUserId: number;
let activeBudgetId: number;
let archivedBudgetId: number;
let janPeriodId: number; // active budget — Jan 2026
let febPeriodId: number; // active budget — Feb 2026
let archivedJanPeriodId: number; // archived budget — Jan 2026

let invoiceVerifiedId: number; // already correctly linked to janPeriod
let invoiceUnlinkedId: number; // no billed cost link
let invoiceMislinkedId: number; // linked to wrong period
let invoiceUnresolvableId: number; // date outside any period

let correctBilledCostId: number; // billed cost in janPeriod for verified invoice
let wrongBilledCostId: number; // billed cost in febPeriod (wrong) for mislinked invoice

// ── Setup & Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  // 1. Create an admin user
  const [user] = await db
    .insert(users)
    .values({
      name: "Integration Test Admin",
      email: `sync-test-${Date.now()}@test.local`,
      passwordHash: "not-a-real-hash",
      role: "admin",
    })
    .returning({ id: users.id });
  adminUserId = user.id;

  // 2. Create an active annual budget (FY 2026)
  const [activeBudget] = await db
    .insert(annualBudgets)
    .values({
      fiscalYear: 20260 + Math.floor(Math.random() * 10000), // unique
      totalAmountCents: 1_200_000,
      originalAmountCents: 1_200_000,
      periodType: "monthly",
      status: "active",
    })
    .returning({ id: annualBudgets.id });
  activeBudgetId = activeBudget.id;

  // 3. Create an archived annual budget (older FY)
  const [archivedBudget] = await db
    .insert(annualBudgets)
    .values({
      fiscalYear: 20250 + Math.floor(Math.random() * 10000),
      totalAmountCents: 1_000_000,
      originalAmountCents: 1_000_000,
      periodType: "monthly",
      status: "archived",
    })
    .returning({ id: annualBudgets.id });
  archivedBudgetId = archivedBudget.id;

  // 4. Create budget periods
  const [jan] = await db
    .insert(budgetPeriods)
    .values({
      budgetId: activeBudgetId,
      periodLabel: "Jan 2026",
      periodIndex: 0,
      startDate: "2026-01-01",
      endDate: "2026-02-01",
      plannedAmountCents: 100_000,
    })
    .returning({ id: budgetPeriods.id });
  janPeriodId = jan.id;

  const [feb] = await db
    .insert(budgetPeriods)
    .values({
      budgetId: activeBudgetId,
      periodLabel: "Feb 2026",
      periodIndex: 1,
      startDate: "2026-02-01",
      endDate: "2026-03-01",
      plannedAmountCents: 100_000,
    })
    .returning({ id: budgetPeriods.id });
  febPeriodId = feb.id;

  const [archivedJan] = await db
    .insert(budgetPeriods)
    .values({
      budgetId: archivedBudgetId,
      periodLabel: "Jan 2026 (archived)",
      periodIndex: 0,
      startDate: "2026-01-01",
      endDate: "2026-02-01",
      plannedAmountCents: 80_000,
    })
    .returning({ id: budgetPeriods.id });
  archivedJanPeriodId = archivedJan.id;

  // 5. Create billed costs for linked invoices
  const [correctCost] = await db
    .insert(billedCosts)
    .values({
      periodId: janPeriodId,
      amountCents: 5000,
      invoiceDate: "2026-01-15",
      description: "Invoice INV-VERIFIED",
    })
    .returning({ id: billedCosts.id });
  correctBilledCostId = correctCost.id;

  const [wrongCost] = await db
    .insert(billedCosts)
    .values({
      periodId: febPeriodId, // wrong — invoice date is in Jan
      amountCents: 3000,
      invoiceDate: "2026-01-20",
      description: "Invoice INV-MISLINKED",
    })
    .returning({ id: billedCosts.id });
  wrongBilledCostId = wrongCost.id;

  // 6. Create invoices
  const [invVerified] = await db
    .insert(invoices)
    .values({
      invoiceNumber: "INV-VERIFIED",
      invoiceDate: "2026-01-15",
      amountCents: 5000,
      vendor: "Acme",
      linkedBilledCostId: correctBilledCostId,
      blobUrl: "https://r2.example.com/inv-verified.pdf",
      blobPathname: "invoices/inv-verified.pdf",
      uploadedBy: adminUserId,
    })
    .returning({ id: invoices.id });
  invoiceVerifiedId = invVerified.id;

  const [invUnlinked] = await db
    .insert(invoices)
    .values({
      invoiceNumber: "INV-UNLINKED",
      invoiceDate: "2026-02-10",
      amountCents: 8000,
      vendor: "ToolCorp",
      linkedBilledCostId: null,
      blobUrl: "https://r2.example.com/inv-unlinked.pdf",
      blobPathname: "invoices/inv-unlinked.pdf",
      uploadedBy: adminUserId,
    })
    .returning({ id: invoices.id });
  invoiceUnlinkedId = invUnlinked.id;

  const [invMislinked] = await db
    .insert(invoices)
    .values({
      invoiceNumber: "INV-MISLINKED",
      invoiceDate: "2026-01-20",
      amountCents: 3000,
      vendor: null,
      linkedBilledCostId: wrongBilledCostId,
      blobUrl: "https://r2.example.com/inv-mislinked.pdf",
      blobPathname: "invoices/inv-mislinked.pdf",
      uploadedBy: adminUserId,
    })
    .returning({ id: invoices.id });
  invoiceMislinkedId = invMislinked.id;

  const [invUnresolvable] = await db
    .insert(invoices)
    .values({
      invoiceNumber: "INV-UNRESOLVABLE",
      invoiceDate: "2020-06-15",
      amountCents: 1000,
      vendor: "OldVendor",
      linkedBilledCostId: null,
      blobUrl: "https://r2.example.com/inv-old.pdf",
      blobPathname: "invoices/inv-old.pdf",
      uploadedBy: adminUserId,
    })
    .returning({ id: invoices.id });
  invoiceUnresolvableId = invUnresolvable.id;
});

afterAll(async () => {
  // Clean up in reverse dependency order
  await db.delete(invoices).where(eq(invoices.uploadedBy, adminUserId));
  // Clean billed costs from our test periods
  await db.delete(billedCosts).where(eq(billedCosts.periodId, janPeriodId));
  await db.delete(billedCosts).where(eq(billedCosts.periodId, febPeriodId));
  await db
    .delete(billedCosts)
    .where(eq(billedCosts.periodId, archivedJanPeriodId));
  await db
    .delete(budgetPeriods)
    .where(eq(budgetPeriods.budgetId, activeBudgetId));
  await db
    .delete(budgetPeriods)
    .where(eq(budgetPeriods.budgetId, archivedBudgetId));
  await db.delete(annualBudgets).where(eq(annualBudgets.id, activeBudgetId));
  await db.delete(annualBudgets).where(eq(annualBudgets.id, archivedBudgetId));
  await db.delete(users).where(eq(users.id, adminUserId));
});

// ── T007: Integration tests ─────────────────────────────────────────────────

describe("syncInvoices — integration (real DB)", () => {
  it("correctly categorises all invoice states", async () => {
    const res = await syncInvoices({ dryRun: false });

    expect(res.success).toBe(true);
    const data = (res as { success: true; data: SyncResult }).data;

    // Build a lookup by invoice id
    const byId = new Map(data.items.map((item) => [item.invoiceId, item]));

    // Verified: already linked to correct period
    const verified = byId.get(invoiceVerifiedId);
    expect(verified).toBeDefined();
    expect(verified!.outcome).toBe("verified");

    // Newly linked: was unlinked, now linked to Feb 2026
    const linked = byId.get(invoiceUnlinkedId);
    expect(linked).toBeDefined();
    expect(linked!.outcome).toBe("newly_linked");
    expect(linked!.newPeriodLabel).toBe("Feb 2026");

    // Corrected: was in Feb, moved to Jan
    const corrected = byId.get(invoiceMislinkedId);
    expect(corrected).toBeDefined();
    expect(corrected!.outcome).toBe("corrected");
    expect(corrected!.newPeriodLabel).toBe("Jan 2026");

    // Unresolvable: date 2020-06-15 has no covering period
    const unresolvable = byId.get(invoiceUnresolvableId);
    expect(unresolvable).toBeDefined();
    expect(unresolvable!.outcome).toBe("unresolvable");
  });

  it("persists DB changes for newly_linked and corrected invoices", async () => {
    // After the first sync (ran in previous test), check DB state.

    // Unlinked invoice should now have a linkedBilledCostId
    const [unlinkedInv] = await db
      .select({
        linkedBilledCostId: invoices.linkedBilledCostId,
      })
      .from(invoices)
      .where(eq(invoices.id, invoiceUnlinkedId));
    expect(unlinkedInv.linkedBilledCostId).not.toBeNull();

    // Its new billed cost should be in the Feb period
    const [unlinkedCost] = await db
      .select({ periodId: billedCosts.periodId })
      .from(billedCosts)
      .where(eq(billedCosts.id, unlinkedInv.linkedBilledCostId!));
    expect(unlinkedCost.periodId).toBe(febPeriodId);

    // Mislinked invoice should now point to a billed cost in Jan
    const [mislinkedInv] = await db
      .select({
        linkedBilledCostId: invoices.linkedBilledCostId,
      })
      .from(invoices)
      .where(eq(invoices.id, invoiceMislinkedId));
    expect(mislinkedInv.linkedBilledCostId).not.toBeNull();
    // Should NOT be the old wrong cost
    expect(mislinkedInv.linkedBilledCostId).not.toBe(wrongBilledCostId);

    const [mislinkedCost] = await db
      .select({ periodId: billedCosts.periodId })
      .from(billedCosts)
      .where(eq(billedCosts.id, mislinkedInv.linkedBilledCostId!));
    expect(mislinkedCost.periodId).toBe(janPeriodId);
  });

  it("is idempotent — second sync classifies everything as 'verified' (except unresolvable)", async () => {
    const res = await syncInvoices({ dryRun: false });

    expect(res.success).toBe(true);
    const data = (res as { success: true; data: SyncResult }).data;

    // Build a lookup by invoice id — only look at our test invoices
    const testIds = new Set([
      invoiceVerifiedId,
      invoiceUnlinkedId,
      invoiceMislinkedId,
      invoiceUnresolvableId,
    ]);
    const ours = data.items.filter((item) => testIds.has(item.invoiceId));

    for (const item of ours) {
      if (item.invoiceId === invoiceUnresolvableId) {
        // Still unresolvable — no period covers 2020
        expect(item.outcome).toBe("unresolvable");
      } else {
        // Everything else should now be verified
        expect(item.outcome).toBe("verified");
      }
    }

    expect(data.newlyLinked).toBe(0);
    expect(data.corrected).toBe(0);
  });
});
