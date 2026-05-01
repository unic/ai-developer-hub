import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the sync framework - make withSyncLock invoke the callback directly
const mockWithSyncLock = vi.fn();
vi.mock("@/lib/sync/framework", () => ({
  withSyncLock: (...args: unknown[]) => mockWithSyncLock(...args),
  retryWithBackoff: (fn: () => Promise<unknown>) => fn(),
}));

// Mock database
vi.mock("@/lib/db", () => ({
  db: {
    execute: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock schema (imported but only used for type reference in raw SQL)
vi.mock("@/lib/db/schema", () => ({
  anthropicWorkspaceCosts: {},
}));

// Mock constants
vi.mock("@/lib/anthropic-constants", () => ({
  ANTHROPIC_API_VERSION: "2024-01-01",
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Set required env
vi.stubEnv("ANTHROPIC_ADMIN_API_KEY", "test-key");

import { run } from "@/lib/sync/sources/anthropic-workspace";

// Helper to make withSyncLock invoke the callback and return its result
function setupWithSyncLock() {
  mockWithSyncLock.mockImplementation(
    async (
      _params: unknown,
      callback: (eventId: number) => Promise<unknown>
    ) => {
      const counts = await callback(1);
      return { eventId: 1, ...(counts as object) };
    }
  );
}

// Helper to create a successful workspace API response
function workspacesResponse(
  data: Array<{ id: string; name: string }> = []
) {
  return new Response(
    JSON.stringify({
      data: data.map((d) => ({
        ...d,
        is_default: false,
        is_archived: false,
      })),
      has_more: false,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

// Helper to create a successful cost report API response
function costReportResponse(
  results: Array<{ workspace_id: string | null; amount: string }> = []
) {
  return new Response(
    JSON.stringify({
      data: [
        { starting_at: "2026-01-01", ending_at: "2026-02-01", results },
      ],
      has_more: false,
      next_page: null,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("anthropic-workspace date-range capping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupWithSyncLock();
  });

  // Guarantee fake timers are reset even if an assertion throws — leaked
  // fake timers cascade into unrelated test failures.
  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips cost fetch when now equals startDate (month just began)", async () => {
    vi.useFakeTimers();
    // Cron fires at the exact start of May 2026 — the scenario from issue #72
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 1, 0, 0, 0))); // 2026-05-01T00:00:00Z

    // Workspace call succeeds
    mockFetch.mockResolvedValueOnce(workspacesResponse([]));
    // No cost report call should be made — month just started, ending_at would equal starting_at

    const result = await run(1, { month: "2026-05" });
    expect(result).toHaveProperty("eventId");
    // Only the workspace fetch should have been called (1 call), not the cost report
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("caps endDate to now when month end is in the future", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 15, 12, 0, 0))); // 2026-05-15T12:00:00Z

    mockFetch.mockResolvedValueOnce(workspacesResponse([]));
    mockFetch.mockResolvedValueOnce(
      costReportResponse([{ workspace_id: "ws1", amount: "500.00" }])
    );

    await run(1, { month: "2026-05" });

    // The cost report fetch should have been called
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Verify ending_at in the URL is not June 1 (which would be in the future)
    const costReportCall = mockFetch.mock.calls[1];
    const calledUrl: string = costReportCall[0] as string;
    expect(calledUrl).not.toContain("2026-06-01");
    // ending_at should encode the current time (2026-05-15T12:00:00.000Z)
    expect(calledUrl).toContain("2026-05-15");
  });

  it("uses full month range for past months without capping", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 15))); // May 15

    mockFetch.mockResolvedValueOnce(workspacesResponse([]));
    mockFetch.mockResolvedValueOnce(
      costReportResponse([{ workspace_id: null, amount: "1000.00" }])
    );

    await run(1, { month: "2026-04" }); // April is fully in the past

    const costReportCall = mockFetch.mock.calls[1];
    const calledUrl: string = costReportCall[0] as string;
    // ending_at should be May 1 (full month range) not capped to now
    expect(calledUrl).toContain("2026-05-01");
  });

  it("skips current-month iteration in backfill when cron fires at exact month start", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 1, 0, 0, 0))); // 2026-05-01T00:00:00Z

    // Workspaces succeeds
    mockFetch.mockResolvedValueOnce(workspacesResponse([]));
    // April cost report succeeds
    mockFetch.mockResolvedValueOnce(
      costReportResponse([{ workspace_id: "ws1", amount: "300.00" }])
    );
    // May cost report must NOT be called (effectiveEnd <= startDate)

    const result = await run(1, {
      backfillStartDate: new Date(Date.UTC(2026, 3, 1)), // Apr 2026
    });

    expect(result).toHaveProperty("eventId");
    // 1 workspace + 1 April cost report = 2 calls; May should be skipped
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("anthropic-workspace backfill error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupWithSyncLock();
  });

  // Guarantee fake timers are reset even if an assertion throws.
  afterEach(() => {
    vi.useRealTimers();
  });

  it("continues cost sync when workspace metadata fetch fails", async () => {
    // First call (workspaces) fails, second call (cost report) succeeds
    mockFetch
      .mockResolvedValueOnce(
        new Response("Internal Server Error", { status: 500 })
      )
      .mockResolvedValueOnce(
        costReportResponse([{ workspace_id: "ws1", amount: "100.00" }])
      );

    const result = await run(1, { month: "2026-01" });
    // Should have an eventId (sync completed, not aborted)
    expect(result).toHaveProperty("eventId");
    // Cost report fetch should have been called (2 fetch calls total)
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("continues to next month when one month fails during backfill", async () => {
    // Fix "now" so we know exactly which months are iterated
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 1, 15))); // Feb 15, 2026

    // Workspaces succeeds
    mockFetch.mockResolvedValueOnce(
      workspacesResponse([{ id: "ws1", name: "Test" }])
    );
    // Jan cost report fails
    mockFetch.mockResolvedValueOnce(
      new Response("timeout", { status: 504 })
    );
    // Feb cost report succeeds
    mockFetch.mockResolvedValueOnce(
      costReportResponse([{ workspace_id: "ws1", amount: "200.00" }])
    );

    // Backfill Jan-Feb 2026
    const result = await run(1, {
      backfillStartDate: new Date(Date.UTC(2026, 0, 1)), // Jan 2026
    });

    expect(result).toHaveProperty("eventId");
    // 1 workspace + 2 cost report calls (Jan fails, Feb succeeds)
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("reports error counts for partial failures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 1, 15))); // Feb 15, 2026

    let capturedCounts: unknown;
    mockWithSyncLock.mockImplementation(
      async (
        _params: unknown,
        callback: (eventId: number) => Promise<unknown>
      ) => {
        capturedCounts = await callback(1);
        return { eventId: 1 };
      }
    );

    // Workspaces succeeds
    mockFetch.mockResolvedValueOnce(workspacesResponse([]));
    // Jan fails
    mockFetch.mockResolvedValueOnce(
      new Response("error", { status: 500 })
    );
    // Feb succeeds
    mockFetch.mockResolvedValueOnce(
      costReportResponse([{ workspace_id: null, amount: "50.00" }])
    );

    await run(1, {
      backfillStartDate: new Date(Date.UTC(2026, 0, 1)),
    });

    expect(capturedCounts).toMatchObject({
      errorCount: 1,
    });
    // The failed month string depends on timezone offset in the Date constructor;
    // just verify the error message references some month.
    expect(
      (capturedCounts as { errorMessage?: string }).errorMessage
    ).toMatch(/Backfill failed for \d{4}-\d{2}/);
  });

  it("returns zero errorCount on fully successful sync", async () => {
    let capturedCounts: unknown;
    mockWithSyncLock.mockImplementation(
      async (
        _params: unknown,
        callback: (eventId: number) => Promise<unknown>
      ) => {
        capturedCounts = await callback(1);
        return { eventId: 1 };
      }
    );

    // Workspaces succeeds
    mockFetch.mockResolvedValueOnce(
      workspacesResponse([{ id: "ws1", name: "Test" }])
    );
    // Cost report succeeds
    mockFetch.mockResolvedValueOnce(
      costReportResponse([{ workspace_id: "ws1", amount: "100.00" }])
    );

    await run(1, { month: "2026-01" });

    expect(capturedCounts).toMatchObject({
      errorCount: 0,
    });
    expect(
      (capturedCounts as { errorMessage?: string | null }).errorMessage
    ).toBeUndefined();
  });

  it("accumulates workspace and cost errors in errorMessage", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 15))); // Jan 15, 2026

    let capturedCounts: unknown;
    mockWithSyncLock.mockImplementation(
      async (
        _params: unknown,
        callback: (eventId: number) => Promise<unknown>
      ) => {
        capturedCounts = await callback(1);
        return { eventId: 1 };
      }
    );

    // Workspaces fails
    mockFetch.mockResolvedValueOnce(
      new Response("workspace error", { status: 503 })
    );
    // Jan cost report also fails
    mockFetch.mockResolvedValueOnce(
      new Response("cost error", { status: 500 })
    );

    await run(1, {
      backfillStartDate: new Date(Date.UTC(2026, 0, 1)),
    });

    expect(capturedCounts).toMatchObject({
      errorCount: 2, // 1 workspace + 1 cost month
    });
    const msg = (capturedCounts as { errorMessage: string }).errorMessage;
    // Should contain both workspace and backfill error info
    expect(msg).toContain("Workspace metadata sync failed");
    expect(msg).toMatch(/Backfill failed for \d{4}-\d{2}/);
  });
});
