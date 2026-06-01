import { describe, it, expect, afterEach, vi } from "vitest";

// computeSyncWindow is a pure helper, but importing its module pulls in the DB
// pool, env validation, and a top-level `sql` template over the schema. Stub
// those import-time dependencies so the unit under test loads in isolation.
vi.mock("@/lib/env", () => ({ env: { ANTHROPIC_ADMIN_API_KEY: undefined } }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({
  anthropicUsageMetrics: {},
  anthropicSyncStatus: {},
  licenseAssignments: {},
  aiTools: { vendor: {}, name: {}, id: {} },
}));
vi.mock("@/lib/crypto", () => ({ decryptApiKey: vi.fn() }));
vi.mock("@/lib/anthropic-keys", () => ({
  fetchOrgApiKeys: vi.fn(),
  resolveApiKeyId: vi.fn(),
}));
vi.mock("@/lib/anthropic-pricing", () => ({
  resolveModelPricing: vi.fn(),
  computeCostCents: vi.fn(),
}));

import { computeSyncWindow } from "@/lib/anthropic-sync";

// computeSyncWindow returns the historical (daily-bucket) window. Today is
// fetched separately with hourly buckets, so endingAt is always start-of-today
// UTC. These tests pin "now" and assert the window is always valid for a
// bucket_width=1d request (startingAt strictly before endingAt).

describe("computeSyncWindow", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ends at start-of-today UTC", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 15, 9, 30, 0))); // 2026-06-15T09:30Z
    const { endingAt } = computeSyncWindow("2026-06-14");
    expect(endingAt).toBe("2026-06-15T00:00:00Z");
  });

  it("starts one day before the latest stored date (re-sync the boundary day)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 15, 9, 30, 0)));
    const { startingAt, endingAt } = computeSyncWindow("2026-06-14");
    // latest - 1 day = 2026-06-13
    expect(startingAt).toBe("2026-06-13T00:00:00Z");
    expect(endingAt).toBe("2026-06-15T00:00:00Z");
  });

  it("backfills DEFAULT_BACKFILL_DAYS (31) when there is no stored date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 15, 9, 30, 0)));
    const { startingAt, endingAt } = computeSyncWindow(null);
    expect(startingAt).toBe("2026-05-15T00:00:00Z"); // 31 days before Jun 15
    expect(endingAt).toBe("2026-06-15T00:00:00Z");
  });

  it("yields a valid one-day window when the latest date is yesterday's-edge (latest = today)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 15, 9, 30, 0)));
    // latest == today: startDate = today-1 = yesterday, endDate = today
    const { startingAt, endingAt } = computeSyncWindow("2026-06-15");
    expect(startingAt).toBe("2026-06-14T00:00:00Z");
    expect(endingAt).toBe("2026-06-15T00:00:00Z");
    expect(new Date(startingAt).getTime()).toBeLessThan(
      new Date(endingAt).getTime()
    );
  });

  it("clamps a future-dated latest so the range is never zero-width or inverted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 15, 9, 30, 0)));
    // Pathological: a stored date in the future (bad backfill / clock skew).
    // Without the guard, startDate (latest-1 = Jun 17) would exceed endDate
    // (Jun 15) and the API would 400. The clamp pins startDate to yesterday.
    const { startingAt, endingAt } = computeSyncWindow("2026-06-18");
    expect(startingAt).toBe("2026-06-14T00:00:00Z");
    expect(endingAt).toBe("2026-06-15T00:00:00Z");
    expect(new Date(startingAt).getTime()).toBeLessThan(
      new Date(endingAt).getTime()
    );
  });

  it("always produces startingAt strictly before endingAt across a month boundary", () => {
    vi.useFakeTimers();
    // First of the month — the scenario class that broke the cost path.
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 1, 0, 5, 0))); // 2026-07-01T00:05Z
    const { startingAt, endingAt } = computeSyncWindow("2026-06-30");
    expect(endingAt).toBe("2026-07-01T00:00:00Z");
    expect(startingAt).toBe("2026-06-29T00:00:00Z");
    expect(new Date(startingAt).getTime()).toBeLessThan(
      new Date(endingAt).getTime()
    );
  });
});
