import { describe, it, expect, vi, beforeEach } from "vitest";

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

describe("anthropic-workspace backfill error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupWithSyncLock();
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

    vi.useRealTimers();
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

    vi.useRealTimers();
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

    vi.useRealTimers();
  });
});
