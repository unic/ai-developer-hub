import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  dominantModelPerDay,
  USER_TOP_DATES_LIMIT,
} from "@/lib/anthropic-users-utils";

// ---------------------------------------------------------------------------
// dominantModelPerDay (T304)
//
// Pure helper exercised in `getUserDetail` to derive the dominant model per
// calendar day for the "Top dates" table. Boundary cases are pinned here so a
// future refactor of the helper can't quietly drop the tie-break / zero-cost
// rules.
// ---------------------------------------------------------------------------

describe("dominantModelPerDay", () => {
  it("returns one entry per distinct date, picking the highest-cost model", () => {
    const map = dominantModelPerDay([
      { date: "2026-05-01", model: "sonnet", cents: 300 },
      { date: "2026-05-01", model: "opus", cents: 800 },
      { date: "2026-05-02", model: "opus", cents: 100 },
      { date: "2026-05-02", model: "haiku", cents: 500 },
    ]);
    expect(map.get("2026-05-01")).toBe("opus");
    expect(map.get("2026-05-02")).toBe("haiku");
    expect(map.size).toBe(2);
  });

  it("ignores zero-cost contributions", () => {
    const map = dominantModelPerDay([
      { date: "2026-05-01", model: "opus", cents: 0 },
      { date: "2026-05-01", model: "haiku", cents: 50 },
    ]);
    expect(map.get("2026-05-01")).toBe("haiku");
  });

  it("returns null for a date that has only zero-cost rows", () => {
    const map = dominantModelPerDay([
      { date: "2026-05-01", model: "opus", cents: 0 },
      { date: "2026-05-01", model: "sonnet", cents: 0 },
    ]);
    expect(map.get("2026-05-01")).toBeNull();
  });

  it("breaks ties alphabetically by model name for determinism", () => {
    const map = dominantModelPerDay([
      { date: "2026-05-01", model: "sonnet", cents: 500 },
      { date: "2026-05-01", model: "haiku", cents: 500 },
    ]);
    expect(map.get("2026-05-01")).toBe("haiku");
  });

  it("returns an empty map for an empty input", () => {
    expect(dominantModelPerDay([])).toEqual(new Map());
  });

  it("USER_TOP_DATES_LIMIT is the canonical 5", () => {
    expect(USER_TOP_DATES_LIMIT).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// getUserDetail — edge cases (T304)
//
// We mock the DB module so the action runs through its branching logic without
// a live database. The mocks return predictable shapes that exercise:
//   - non-existent userId  → returns null
//   - LOCK_USER_ID         → returns null (sentinel exclusion)
//   - non-positive userId  → returns null
//   - zero-usage user      → daily totals all zero, modelBreakdown empty,
//                            topDates empty, hasUnresolvedPricing = false
//   - pricing_resolved=false on at least one row → hasUnresolvedPricing = true
// ---------------------------------------------------------------------------

// Hoisted-safe module-level state used by the mock factory below.
type FakeExecuteResult = { rows: unknown[] };
const fakeExecuteQueue: FakeExecuteResult[] = [];

vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: vi.fn(async () => ({ id: 1, role: "admin" })),
}));

vi.mock("next/cache", () => ({
  // Strip the cache so the underlying function runs exactly once.
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    execute: vi.fn(async () => {
      const next = fakeExecuteQueue.shift();
      if (!next) return { rows: [] };
      return next;
    }),
  },
}));

describe("getUserDetail — guard paths", () => {
  beforeEach(() => {
    fakeExecuteQueue.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // The first import of the action module is slow (Next.js + Drizzle + Zod
  // cold-start) on Windows runners, so bump the per-test timeout to keep this
  // suite robust.
  it("returns null when userId is the LOCK_USER_ID sentinel (0)", { timeout: 30_000 }, async () => {
    const { getUserDetail } = await import("@/actions/anthropic-users");
    const result = await getUserDetail(0);
    expect(result).toBeNull();
  });

  it("returns null when userId is non-positive", async () => {
    const { getUserDetail } = await import("@/actions/anthropic-users");
    expect(await getUserDetail(-1)).toBeNull();
  });

  it("returns null when the user does not exist", async () => {
    // Only the first execute() call (user meta lookup) runs in this branch.
    fakeExecuteQueue.push({ rows: [] });
    const { getUserDetail } = await import("@/actions/anthropic-users");
    const result = await getUserDetail(9999);
    expect(result).toBeNull();
  });
});

describe("getUserDetail — zero-usage edge case", () => {
  beforeEach(() => {
    fakeExecuteQueue.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a fully-zero payload when the user has no usage rows", async () => {
    // 1) user meta — existing user, no workspace.
    fakeExecuteQueue.push({
      rows: [
        {
          id: 42,
          name: "Zero User",
          email: "zero@example.com",
          circle: null,
          profile: null,
          status: "active",
          role: "viewer",
          resolved_workspace_id: null,
          workspace_name: null,
          workspace_color: null,
        },
      ],
    });
    // 2) usage rows for the selected month — empty.
    fakeExecuteQueue.push({ rows: [] });
    // 3) prior month total — empty (no row → defaults to 0).
    fakeExecuteQueue.push({ rows: [{ cents: 0 }] });
    // 4) twelve-month rollup — empty.
    fakeExecuteQueue.push({ rows: [] });
    // 5) _getUserMonths — empty.
    fakeExecuteQueue.push({ rows: [] });

    const { getUserDetail } = await import("@/actions/anthropic-users");
    const result = await getUserDetail(42, "2026-05");

    expect(result).not.toBeNull();
    expect(result!.currentMonthCents).toBe(0);
    expect(result!.priorMonthCents).toBe(0);
    expect(result!.momDeltaCents).toBe(0);
    expect(result!.momDeltaPct).toBeNull();
    expect(result!.projectedMonthEndCents).toBe(0);
    expect(result!.modelBreakdown).toEqual([]);
    expect(result!.topDates).toEqual([]);
    expect(result!.hasUnresolvedPricing).toBe(false);
    // Daily totals padded to every day of May (31 entries), all zero.
    expect(result!.dailyTotals).toHaveLength(31);
    expect(result!.dailyTotals.every((d) => d.costCents === 0)).toBe(true);
    // Twelve-month padded to 12 zeros.
    expect(result!.twelveMonth).toHaveLength(12);
    expect(result!.twelveMonth.every((m) => m.totalCents === 0)).toBe(true);
  });

  it("surfaces hasUnresolvedPricing when at least one row is unresolved", async () => {
    fakeExecuteQueue.push({
      rows: [
        {
          id: 7,
          name: "Pricing Mystery",
          email: "pm@example.com",
          circle: null,
          profile: null,
          status: "active",
          role: "viewer",
          resolved_workspace_id: null,
          workspace_name: null,
          workspace_color: null,
        },
      ],
    });
    fakeExecuteQueue.push({
      rows: [
        {
          date: "2026-05-10",
          model: "future-model",
          uncached_input_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          output_tokens: 0,
          computed_cost_cents: 0,
          pricing_resolved: false,
        },
      ],
    });
    fakeExecuteQueue.push({ rows: [{ cents: 0 }] });
    fakeExecuteQueue.push({ rows: [] });
    fakeExecuteQueue.push({ rows: [] });

    const { getUserDetail } = await import("@/actions/anthropic-users");
    const result = await getUserDetail(7, "2026-05");

    expect(result).not.toBeNull();
    expect(result!.hasUnresolvedPricing).toBe(true);
  });
});
