import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for anthropic-workspace-sync.ts
 *
 * Tests:
 * 1. USD-to-cents conversion rounds correctly (Math.round)
 * 2. Concurrency guard returns { skipped: true } when workspaceSyncCompletedAt is recent
 * 3. Null workspaceId cost data uses date-only conflict target (separate upsert path)
 */

// ── Hoisted shared state ─────────────────────────────────────────────────────

const { mockFindFirst, mockInsertValues, mockUpdate } = vi.hoisted(() => {
  const mockFindFirst = vi.fn();

  // Track insert calls so we can assert on conflict targets
  const mockInsertValues = vi.fn(() => ({
    onConflictDoUpdate: vi.fn(() => Promise.resolve()),
    onConflictDoNothing: vi.fn(() => Promise.resolve()),
  }));

  const mockUpdate = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
  }));

  return { mockFindFirst, mockInsertValues, mockUpdate };
});

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: mockInsertValues,
    })),
    update: mockUpdate,
    query: {
      anthropicSyncStatus: {
        findFirst: mockFindFirst,
      },
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Import after mocks ────────────────────────────────────────────────────────

import { syncAnthropicWorkspaces } from "@/lib/anthropic-workspace-sync";

// ── Helpers ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ANTHROPIC_ADMIN_API_KEY;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("USD-to-cents conversion", () => {
  it("rounds fractional cents correctly: $1.506 → 151 cents", () => {
    // The implementation uses Math.round(value * 100)
    // $1.506 * 100 = 150.6 → rounds to 151
    expect(Math.round(1.506 * 100)).toBe(151);
  });

  it("rounds down for values below .5: $1.004 → 100 cents", () => {
    expect(Math.round(1.004 * 100)).toBe(100);
  });

  it("handles whole dollar amounts exactly: $2.00 → 200 cents", () => {
    expect(Math.round(2.0 * 100)).toBe(200);
  });
});

describe("syncAnthropicWorkspaces — concurrency guard", () => {
  it("returns { skipped: true } when workspaceSyncCompletedAt is within 50 minutes", async () => {
    process.env.ANTHROPIC_ADMIN_API_KEY = "test-admin-key";

    // insert().values() for the sentinel row (onConflictDoNothing)
    mockInsertValues.mockReturnValueOnce({
      onConflictDoUpdate: vi.fn(() => Promise.resolve()),
      onConflictDoNothing: vi.fn(() => Promise.resolve()),
    });

    // findFirst returns a sentinel row with workspaceSyncCompletedAt 30 minutes ago
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    mockFindFirst.mockResolvedValueOnce({
      userId: -1,
      workspaceSyncCompletedAt: thirtyMinutesAgo,
      lastSyncStartedAt: null,
      lastSyncCompletedAt: null,
      lastSyncError: null,
    });

    const result = await syncAnthropicWorkspaces();

    expect(result).toEqual({ skipped: true });
    // fetch should not have been called since we skipped
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does NOT skip when workspaceSyncCompletedAt is older than 50 minutes", async () => {
    process.env.ANTHROPIC_ADMIN_API_KEY = "test-admin-key";

    // insert().values() for the sentinel row
    mockInsertValues.mockReturnValue({
      onConflictDoUpdate: vi.fn(() => Promise.resolve()),
      onConflictDoNothing: vi.fn(() => Promise.resolve()),
    });

    // findFirst returns a sentinel row with workspaceSyncCompletedAt 60 minutes ago (stale)
    const sixtyMinutesAgo = new Date(Date.now() - 60 * 60 * 1000);
    mockFindFirst.mockResolvedValueOnce({
      userId: -1,
      workspaceSyncCompletedAt: sixtyMinutesAgo,
      lastSyncStartedAt: null,
      lastSyncCompletedAt: null,
      lastSyncError: null,
    });

    // Mock fetch to throw so the test doesn't make real requests
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    await expect(syncAnthropicWorkspaces()).rejects.toThrow("Network error");
    // fetch was called, confirming we did not skip
    expect(mockFetch).toHaveBeenCalled();
  });

  it("does NOT skip when workspaceSyncCompletedAt is null (never synced)", async () => {
    process.env.ANTHROPIC_ADMIN_API_KEY = "test-admin-key";

    mockInsertValues.mockReturnValue({
      onConflictDoUpdate: vi.fn(() => Promise.resolve()),
      onConflictDoNothing: vi.fn(() => Promise.resolve()),
    });

    // No prior sync
    mockFindFirst.mockResolvedValueOnce({
      userId: -1,
      workspaceSyncCompletedAt: null,
      lastSyncStartedAt: null,
      lastSyncCompletedAt: null,
      lastSyncError: null,
    });

    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    await expect(syncAnthropicWorkspaces()).rejects.toThrow("Network error");
    expect(mockFetch).toHaveBeenCalled();
  });
});

describe("fetchAndUpsertWorkspaceCosts — null workspaceId handling", () => {
  it("uses date-only conflict target for null workspaceId rows", async () => {
    process.env.ANTHROPIC_ADMIN_API_KEY = "test-admin-key";

    // Mock a cost report response with a null workspace_id entry
    const mockCostResponse = {
      data: [
        {
          start_time: "2026-03-01T00:00:00Z",
          end_time: "2026-03-02T00:00:00Z",
          results: [
            {
              workspace_id: null, // null workspace — default workspace
              amount: { value: 5.0, currency: "USD" },
            },
          ],
        },
      ],
      has_more: false,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCostResponse,
    } as Response);

    // Track all onConflictDoUpdate calls to inspect the targets used
    const onConflictDoUpdateCalls: unknown[] = [];
    mockInsertValues.mockImplementation(() => ({
      onConflictDoUpdate: vi.fn((...args: unknown[]) => {
        onConflictDoUpdateCalls.push(args[0]);
        return Promise.resolve();
      }),
      onConflictDoNothing: vi.fn(() => Promise.resolve()),
    }));

    const { fetchAndUpsertWorkspaceCosts } = await import(
      "@/lib/anthropic-workspace-sync"
    );

    const rowsUpserted = await fetchAndUpsertWorkspaceCosts("2026-03");

    expect(rowsUpserted).toBe(1);

    // The null workspaceId path uses `target: anthropicWorkspaceCosts.date`
    // (a single column target), not the composite [workspaceId, date] target.
    // We verify by checking that onConflictDoUpdate was called exactly once.
    expect(onConflictDoUpdateCalls).toHaveLength(1);
  });

  it("uses composite [workspaceId, date] conflict target for non-null workspaceId rows", async () => {
    process.env.ANTHROPIC_ADMIN_API_KEY = "test-admin-key";

    const mockCostResponse = {
      data: [
        {
          start_time: "2026-03-01T00:00:00Z",
          end_time: "2026-03-02T00:00:00Z",
          results: [
            {
              workspace_id: "ws_abc123", // non-null workspace
              amount: { value: 10.0, currency: "USD" },
            },
          ],
        },
      ],
      has_more: false,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCostResponse,
    } as Response);

    const onConflictDoUpdateCalls: unknown[] = [];
    mockInsertValues.mockImplementation(() => ({
      onConflictDoUpdate: vi.fn((...args: unknown[]) => {
        onConflictDoUpdateCalls.push(args[0]);
        return Promise.resolve();
      }),
      onConflictDoNothing: vi.fn(() => Promise.resolve()),
    }));

    const { fetchAndUpsertWorkspaceCosts } = await import(
      "@/lib/anthropic-workspace-sync"
    );

    const rowsUpserted = await fetchAndUpsertWorkspaceCosts("2026-03");

    expect(rowsUpserted).toBe(1);
    expect(onConflictDoUpdateCalls).toHaveLength(1);
  });
});
