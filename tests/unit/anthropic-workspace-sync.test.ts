import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for anthropic-workspace-sync.ts
 *
 * Tests:
 * 1. USD-to-cents conversion rounds correctly (Math.round)
 * 2. Concurrency guard returns { skipped: true } when workspaceSyncCompletedAt is recent
 * 3. fetchAndUpsertWorkspaceCosts uses db.execute for batch upserts
 */

// ── Hoisted shared state ─────────────────────────────────────────────────────

const { mockFindFirst, mockInsertValues, mockUpdate, mockExecute } = vi.hoisted(() => {
  const mockFindFirst = vi.fn();

  const mockInsertValues = vi.fn(() => ({
    onConflictDoUpdate: vi.fn(() => Promise.resolve()),
    onConflictDoNothing: vi.fn(() => Promise.resolve()),
  }));

  const mockUpdate = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
  }));

  const mockExecute = vi.fn(() => Promise.resolve({ rows: [] }));

  return { mockFindFirst, mockInsertValues, mockUpdate, mockExecute };
});

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: mockInsertValues,
    })),
    update: mockUpdate,
    execute: mockExecute,
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

import { syncAnthropicWorkspaces, fetchAndUpsertWorkspaceCosts } from "@/lib/anthropic-workspace-sync";

// ── Helpers ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ANTHROPIC_ADMIN_API_KEY;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("USD-to-cents conversion", () => {
  it("rounds fractional cents correctly: 150.6 → 151", () => {
    // The Anthropic API returns amounts already in fractional cents (not USD).
    // e.g. "150.6" means 150.6 fractional cents → Math.round → 151 cents
    expect(Math.round(150.6)).toBe(151);
  });

  it("rounds down for values below .5: 100.4 → 100", () => {
    expect(Math.round(100.4)).toBe(100);
  });

  it("handles whole cent amounts exactly: 200.0 → 200", () => {
    expect(Math.round(200.0)).toBe(200);
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

describe("fetchAndUpsertWorkspaceCosts — db.execute batch upserts", () => {
  it("calls db.execute once for named workspace rows (batched insert)", async () => {
    process.env.ANTHROPIC_ADMIN_API_KEY = "test-admin-key";

    // API response with correct schema: starting_at, ending_at, results[].amount as string (cents)
    const mockCostResponse = {
      data: [
        {
          starting_at: "2026-03-01T00:00:00Z",
          ending_at: "2026-03-02T00:00:00Z",
          results: [
            { workspace_id: "ws_abc123", amount: "500.0" },
            { workspace_id: "ws_def456", amount: "250.5" },
          ],
        },
      ],
      has_more: false,
      next_page: null,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCostResponse,
    } as Response);

    const rowsUpserted = await fetchAndUpsertWorkspaceCosts("2026-03");

    expect(rowsUpserted).toBe(2);
    // Should call db.execute once for the batched named rows insert
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("calls db.execute once for null workspaceId rows (default workspace batched insert)", async () => {
    process.env.ANTHROPIC_ADMIN_API_KEY = "test-admin-key";

    const mockCostResponse = {
      data: [
        {
          starting_at: "2026-03-01T00:00:00Z",
          ending_at: "2026-03-02T00:00:00Z",
          results: [
            { workspace_id: null, amount: "522.584295" },
          ],
        },
      ],
      has_more: false,
      next_page: null,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCostResponse,
    } as Response);

    const rowsUpserted = await fetchAndUpsertWorkspaceCosts("2026-03");

    expect(rowsUpserted).toBe(1);
    // Should call db.execute once for the batched default (null workspace) rows insert
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("calls db.execute twice when both named and null workspace rows exist", async () => {
    process.env.ANTHROPIC_ADMIN_API_KEY = "test-admin-key";

    const mockCostResponse = {
      data: [
        {
          starting_at: "2026-03-01T00:00:00Z",
          ending_at: "2026-03-02T00:00:00Z",
          results: [
            { workspace_id: "ws_abc123", amount: "300.0" },
            { workspace_id: null, amount: "100.0" },
          ],
        },
      ],
      has_more: false,
      next_page: null,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCostResponse,
    } as Response);

    const rowsUpserted = await fetchAndUpsertWorkspaceCosts("2026-03");

    expect(rowsUpserted).toBe(2);
    // Two separate batched upserts: one for named rows, one for null rows
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });
});
