import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SyncResult } from "@/types";

/**
 * We mock the modules that the server action imports so that
 * no real database / auth calls are made during unit tests.
 *
 * vi.hoisted() is used to declare shared state that the hoisted
 * vi.mock() factories can reference safely.
 */

// ── Hoisted shared state (available inside vi.mock factories) ────────────────

const { selectResults, mockDb } = vi.hoisted(() => {
  // Holds rows that each chained query should return.
  const selectResults: unknown[][] = [];

  // Build a chainable query-builder stub whose terminal `.then` / await resolves
  // to whatever `resultFn` returns at call-time.
  function chainable(resultFn: () => unknown) {
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => resolve(resultFn());
        }
        return (..._args: unknown[]) => new Proxy({}, handler);
      },
    };
    return new Proxy({}, handler);
  }

  // Typed as `any` to allow self-reference in transaction mock
  const mockDb: Record<string, unknown> & { transaction: (fn: (tx: unknown) => Promise<void>) => Promise<void> } = {
    select: (..._args: unknown[]) =>
      chainable(() => selectResults.shift() ?? []),
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: 999 }],
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
    delete: () => ({
      where: async () => undefined,
    }),
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      await fn(mockDb);
    },
  };

  return { selectResults, mockDb };
});

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ id: "1", role: "admin" }),
}));

vi.mock("@/actions/history", () => ({
  recordCreation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));

// ── Import after mocks ──────────────────────────────────────────────────────

import { findPeriodForDate, syncInvoices } from "@/actions/invoice-sync";

// ── Helpers ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  selectResults.length = 0;
});

// ── T005: findPeriodForDate ──────────────────────────────────────────────────

describe("findPeriodForDate", () => {
  it("returns the matching period when one exists", async () => {
    selectResults.push([{ id: 10, periodLabel: "Jan 2026" }]);

    const result = await findPeriodForDate("2026-01-15");

    expect(result).toEqual({ id: 10, periodLabel: "Jan 2026" });
  });

  it("returns null when no period covers the date", async () => {
    selectResults.push([]);

    const result = await findPeriodForDate("2020-06-01");

    expect(result).toBeNull();
  });

  it("returns the first row (active budget preferred) when multiple match", async () => {
    // The SQL ORDER BY ensures active comes first; mock returns that order
    selectResults.push([{ id: 5, periodLabel: "Q1 2026 (active)" }]);

    const result = await findPeriodForDate("2026-02-15");

    expect(result).toEqual({ id: 5, periodLabel: "Q1 2026 (active)" });
  });
});

// ── T006: syncInvoices categorisation ────────────────────────────────────────

describe("syncInvoices — categorisation logic", () => {
  /**
   * Helper: set up the two SELECT calls that syncInvoices makes:
   *   1) allInvoices  (from invoices + left-join billedCosts + budgetPeriods)
   *   2) allPeriods   (from budgetPeriods + innerJoin annualBudgets)
   */
  function seedSync(
    allInvoices: {
      id: number;
      invoiceNumber: string;
      invoiceDate: string;
      amountCents: number;
      vendor: string | null;
      linkedBilledCostId: number | null;
      currentPeriodId: number | null;
      currentPeriodLabel: string | null;
    }[],
    allPeriods: {
      id: number;
      periodLabel: string;
      startDate: string;
      endDate: string;
      budgetStatus: string;
      budgetCreatedAt: Date;
    }[]
  ) {
    selectResults.push(allInvoices, allPeriods);
  }

  const JAN_PERIOD = {
    id: 100,
    periodLabel: "Jan 2026",
    startDate: "2026-01-01",
    endDate: "2026-02-01",
    budgetStatus: "active",
    budgetCreatedAt: new Date("2026-01-01"),
  };

  const FEB_PERIOD = {
    id: 101,
    periodLabel: "Feb 2026",
    startDate: "2026-02-01",
    endDate: "2026-03-01",
    budgetStatus: "active",
    budgetCreatedAt: new Date("2026-01-01"),
  };

  it("classifies a correctly-linked invoice as 'verified'", async () => {
    seedSync(
      [
        {
          id: 1,
          invoiceNumber: "INV-001",
          invoiceDate: "2026-01-15",
          amountCents: 5000,
          vendor: "Acme",
          linkedBilledCostId: 50,
          currentPeriodId: 100,
          currentPeriodLabel: "Jan 2026",
        },
      ],
      [JAN_PERIOD]
    );

    const res = await syncInvoices({ dryRun: true });

    expect(res.success).toBe(true);
    const data = (res as { success: true; data: SyncResult }).data;
    expect(data.verified).toBe(1);
    expect(data.items[0].outcome).toBe("verified");
  });

  it("classifies an unlinked invoice as 'newly_linked'", async () => {
    seedSync(
      [
        {
          id: 2,
          invoiceNumber: "INV-002",
          invoiceDate: "2026-01-20",
          amountCents: 8000,
          vendor: "ToolCorp",
          linkedBilledCostId: null,
          currentPeriodId: null,
          currentPeriodLabel: null,
        },
      ],
      [JAN_PERIOD]
    );

    const res = await syncInvoices({ dryRun: true });

    expect(res.success).toBe(true);
    const data = (res as { success: true; data: SyncResult }).data;
    expect(data.newlyLinked).toBe(1);
    expect(data.items[0].outcome).toBe("newly_linked");
    expect(data.items[0].newPeriodLabel).toBe("Jan 2026");
  });

  it("classifies an invoice linked to the wrong period as 'corrected'", async () => {
    seedSync(
      [
        {
          id: 3,
          invoiceNumber: "INV-003",
          invoiceDate: "2026-01-10",
          amountCents: 3000,
          vendor: null,
          linkedBilledCostId: 60,
          currentPeriodId: 101, // wrongly linked to Feb
          currentPeriodLabel: "Feb 2026",
        },
      ],
      [JAN_PERIOD, FEB_PERIOD]
    );

    const res = await syncInvoices({ dryRun: true });

    expect(res.success).toBe(true);
    const data = (res as { success: true; data: SyncResult }).data;
    expect(data.corrected).toBe(1);
    expect(data.items[0].outcome).toBe("corrected");
    expect(data.items[0].previousPeriodLabel).toBe("Feb 2026");
    expect(data.items[0].newPeriodLabel).toBe("Jan 2026");
  });

  it("classifies an invoice with no matching period as 'unresolvable'", async () => {
    seedSync(
      [
        {
          id: 4,
          invoiceNumber: "INV-004",
          invoiceDate: "2020-06-15",
          amountCents: 1000,
          vendor: "OldVendor",
          linkedBilledCostId: null,
          currentPeriodId: null,
          currentPeriodLabel: null,
        },
      ],
      [JAN_PERIOD] // no period covers 2020-06-15
    );

    const res = await syncInvoices({ dryRun: true });

    expect(res.success).toBe(true);
    const data = (res as { success: true; data: SyncResult }).data;
    expect(data.unresolvable).toBe(1);
    expect(data.items[0].outcome).toBe("unresolvable");
    expect(data.items[0].reason).toMatch(/no budget period/i);
  });

  it("prefers an active budget period over an archived one for the same date", async () => {
    const archivedJan = {
      ...JAN_PERIOD,
      id: 200,
      periodLabel: "Jan 2026 (archived)",
      budgetStatus: "archived",
      budgetCreatedAt: new Date("2025-12-01"),
    };

    seedSync(
      [
        {
          id: 5,
          invoiceNumber: "INV-005",
          invoiceDate: "2026-01-15",
          amountCents: 7000,
          vendor: "Vendor",
          linkedBilledCostId: null,
          currentPeriodId: null,
          currentPeriodLabel: null,
        },
      ],
      [archivedJan, JAN_PERIOD] // active JAN_PERIOD should win
    );

    const res = await syncInvoices({ dryRun: true });

    expect(res.success).toBe(true);
    const data = (res as { success: true; data: SyncResult }).data;
    expect(data.items[0].newPeriodLabel).toBe("Jan 2026");
  });

  it("handles a mix of invoice states in a single sync run", async () => {
    seedSync(
      [
        // verified
        {
          id: 10,
          invoiceNumber: "INV-V",
          invoiceDate: "2026-01-15",
          amountCents: 1000,
          vendor: "V",
          linkedBilledCostId: 50,
          currentPeriodId: 100,
          currentPeriodLabel: "Jan 2026",
        },
        // newly_linked
        {
          id: 11,
          invoiceNumber: "INV-N",
          invoiceDate: "2026-02-10",
          amountCents: 2000,
          vendor: "N",
          linkedBilledCostId: null,
          currentPeriodId: null,
          currentPeriodLabel: null,
        },
        // corrected (linked to Jan but date is in Feb)
        {
          id: 12,
          invoiceNumber: "INV-C",
          invoiceDate: "2026-02-05",
          amountCents: 3000,
          vendor: "C",
          linkedBilledCostId: 60,
          currentPeriodId: 100,
          currentPeriodLabel: "Jan 2026",
        },
        // unresolvable
        {
          id: 13,
          invoiceNumber: "INV-U",
          invoiceDate: "2019-01-01",
          amountCents: 500,
          vendor: "U",
          linkedBilledCostId: null,
          currentPeriodId: null,
          currentPeriodLabel: null,
        },
      ],
      [JAN_PERIOD, FEB_PERIOD]
    );

    const res = await syncInvoices({ dryRun: true });

    expect(res.success).toBe(true);
    const data = (res as { success: true; data: SyncResult }).data;
    expect(data.totalProcessed).toBe(4);
    expect(data.verified).toBe(1);
    expect(data.newlyLinked).toBe(1);
    expect(data.corrected).toBe(1);
    expect(data.unresolvable).toBe(1);
    expect(data.errors).toBe(0);
  });

  it("returns totalProcessed === 0 when there are no invoices", async () => {
    seedSync([], [JAN_PERIOD]);

    const res = await syncInvoices({ dryRun: true });

    expect(res.success).toBe(true);
    const data = (res as { success: true; data: SyncResult }).data;
    expect(data.totalProcessed).toBe(0);
  });
});
