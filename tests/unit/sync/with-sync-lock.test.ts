import { describe, it, expect, beforeEach, vi } from "vitest";

// withSyncLock issues real queries, so the db module must be stubbed before the
// unit under test is imported (see anthropic-sync-window.test.ts). Without this
// the suite would dial a real connection and stall for connectionTimeoutMillis.
const dbMock = vi.hoisted(() => ({
  execute: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));

import {
  withSyncLock,
  STALE_EVENT_AFTER_MS,
  SYNC_MAX_DURATION_MS,
} from "@/lib/sync/framework";

/** update(...).set(...).where(...) — resolves. */
function okUpdate() {
  return { set: () => ({ where: () => Promise.resolve() }) };
}

/** update(...).set(...).where(...) — rejects, e.g. a dead connection. */
function failingUpdate(err: Error) {
  return { set: () => ({ where: () => Promise.reject(err) }) };
}

function insertReturning(id: number) {
  return { values: () => ({ returning: () => Promise.resolve([{ id }]) }) };
}

const LOCK_ACQUIRED = { rows: [{ pg_try_advisory_lock: true }] };
const UNLOCK_OK = { rows: [{ pg_advisory_unlock: true }] };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: reaper + any bookkeeping write succeed.
  dbMock.update.mockImplementation(() => okUpdate());
  dbMock.insert.mockImplementation(() => insertReturning(42));
});

const OK_COUNTS = {
  createdCount: 1,
  updatedCount: 0,
  skippedCount: 0,
  errorCount: 0,
};

describe("stale-event cutoffs", () => {
  // The sweep must never terminate a row a live run could still be writing.
  // Both properties below are the invariant that makes that true; if someone
  // raises the route ceiling without revisiting the cutoffs, this fails.
  it("keeps every cutoff well above the platform ceiling that bounds a run", () => {
    for (const [operation, cutoff] of Object.entries(STALE_EVENT_AFTER_MS)) {
      expect(
        cutoff,
        `${operation} cutoff must exceed the ${SYNC_MAX_DURATION_MS}ms run ceiling`
      ).toBeGreaterThan(SYNC_MAX_DURATION_MS * 10);
    }
  });

  it("gives backfills a longer cutoff than regular runs", () => {
    // Backfills iterate per day / per 31-day window with external calls per
    // step, so they are the runs most likely to outlive a regular cutoff.
    expect(STALE_EVENT_AFTER_MS.backfill).toBeGreaterThan(
      STALE_EVENT_AFTER_MS.regular
    );
  });
});

describe("withSyncLock", () => {
  it("rejects when the lock is already held", async () => {
    dbMock.execute.mockResolvedValueOnce({
      rows: [{ pg_try_advisory_lock: false }],
    });

    await expect(
      withSyncLock({ sourceType: "anthropic_api_usage" }, async () => OK_COUNTS)
    ).rejects.toThrow("Sync already in progress");
  });

  it("sweeps abandoned events before attempting to acquire", async () => {
    dbMock.execute.mockResolvedValueOnce({
      rows: [{ pg_try_advisory_lock: false }],
    });

    await expect(
      withSyncLock({ sourceType: "anthropic_api_usage" }, async () => OK_COUNTS)
    ).rejects.toThrow("Sync already in progress");

    // The sweep must be unconditional — including on attempts that then lose
    // the race, which is the case that used to leave rows stranded forever.
    expect(dbMock.update).toHaveBeenCalledTimes(1);
  });

  it("releases the lock even when the event insert fails", async () => {
    dbMock.execute
      .mockResolvedValueOnce(LOCK_ACQUIRED)
      .mockResolvedValueOnce(UNLOCK_OK);
    dbMock.insert.mockImplementation(() => ({
      values: () => ({ returning: () => Promise.reject(new Error("insert boom")) }),
    }));

    await expect(
      withSyncLock({ sourceType: "anthropic_api_usage" }, async () => OK_COUNTS)
    ).rejects.toThrow("insert boom");

    // execute call 2 is the unlock; previously the insert sat outside the try
    // and a failure here stranded the lock with no release path.
    expect(dbMock.execute).toHaveBeenCalledTimes(2);
  });

  it("propagates the original error, not a bookkeeping failure", async () => {
    dbMock.execute
      .mockResolvedValueOnce(LOCK_ACQUIRED)
      .mockResolvedValueOnce(UNLOCK_OK);
    dbMock.update
      .mockImplementationOnce(() => okUpdate()) // reaper
      .mockImplementationOnce(() => failingUpdate(new Error("bookkeeping boom")));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      withSyncLock({ sourceType: "anthropic_api_usage" }, async () => {
        throw new Error("the real cause");
      })
    ).rejects.toThrow("the real cause");

    consoleSpy.mockRestore();
  });

  it("propagates the original error when the unlock itself throws", async () => {
    dbMock.execute
      .mockResolvedValueOnce(LOCK_ACQUIRED)
      .mockRejectedValueOnce(new Error("unlock boom"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      withSyncLock({ sourceType: "anthropic_api_usage" }, async () => {
        throw new Error("the real cause");
      })
    ).rejects.toThrow("the real cause");

    consoleSpy.mockRestore();
  });

  it("still reports success when the completion write fails", async () => {
    dbMock.execute
      .mockResolvedValueOnce(LOCK_ACQUIRED)
      .mockResolvedValueOnce(UNLOCK_OK);
    dbMock.update
      .mockImplementationOnce(() => okUpdate()) // reaper
      .mockImplementationOnce(() => failingUpdate(new Error("bookkeeping boom")));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // The sync ran and its data is committed; failing to record that must not
    // turn a completed run into a thrown failure.
    const result = await withSyncLock(
      { sourceType: "anthropic_api_usage" },
      async () => OK_COUNTS
    );

    expect(result).toEqual({ eventId: 42 });
    consoleSpy.mockRestore();
  });

  it("logs when the unlock releases nothing", async () => {
    dbMock.execute
      .mockResolvedValueOnce(LOCK_ACQUIRED)
      .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: false }] });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await withSyncLock({ sourceType: "anthropic_api_usage" }, async () => OK_COUNTS);

    // A no-op release means the lock was taken on a different pooler backend
    // and is now leaked — previously silent.
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("advisory unlock was a no-op")
    );
    consoleSpy.mockRestore();
  });
});
