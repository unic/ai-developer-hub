import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { syncEvents } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getLastCompletedSyncEvent, listSyncEvents } from "@/lib/sync/queries";

/**
 * Regression test for the bug where the Copilot UI read "Last sync" from the
 * legacy github_sync_events table while writes had migrated to sync_events.
 *
 * These tests work directly against the query helpers (no auth) — the action
 * wrappers in src/actions/copilot.ts and src/actions/copilot-data.ts just
 * delegate to these helpers, so proving the helpers read from sync_events
 * proves the actions do too.
 */
describe("Copilot read paths read from sync_events", () => {
  const seededIds: number[] = [];

  beforeAll(async () => {
    // Seed two completed copilot events at known timestamps
    const older = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
    const newer = new Date(Date.now() - 10 * 60 * 1000); // 10m ago
    const inProgress = new Date(Date.now() - 1 * 60 * 1000); // 1m ago

    const rows = await db
      .insert(syncEvents)
      .values([
        {
          sourceType: "github_copilot_billing",
          outcome: "success",
          startedAt: older,
          completedAt: older,
          createdCount: 5,
          updatedCount: 2,
        },
        {
          sourceType: "github_copilot_billing",
          outcome: "partial",
          startedAt: newer,
          completedAt: newer,
          createdCount: 3,
          updatedCount: 1,
          errorCount: 1,
          errorMessage: "Test partial",
        },
        {
          sourceType: "github_copilot_billing",
          outcome: "in_progress",
          startedAt: inProgress,
        },
      ])
      .returning({ id: syncEvents.id });

    seededIds.push(...rows.map((r) => r.id));
  });

  afterAll(async () => {
    if (seededIds.length > 0) {
      await db.delete(syncEvents).where(inArray(syncEvents.id, seededIds));
    }
  });

  it("getLastCompletedSyncEvent ignores in_progress and returns the latest completed row", async () => {
    const row = await getLastCompletedSyncEvent("github_copilot_billing");
    expect(row).not.toBeNull();
    // The shared DB may have organic newer rows; only assert on the helper's
    // behavior when it returns a seeded row (guards against ordering races).
    if (row && seededIds.includes(row.id)) {
      expect(row.outcome).toBe("partial");
      expect(row.errorMessage).toBe("Test partial");
    }
  });

  it("listSyncEvents returns rows ordered by startedAt desc and includes in_progress", async () => {
    const rows = await listSyncEvents("github_copilot_billing", 10);
    const seededRows = rows.filter((r) => seededIds.includes(r.id));
    expect(seededRows.length).toBe(3);
    // First should be in_progress (most recent startedAt)
    expect(seededRows[0].outcome).toBe("in_progress");
    expect(seededRows[1].outcome).toBe("partial");
    expect(seededRows[2].outcome).toBe("success");
  });

  it("listSyncEvents respects the limit parameter", async () => {
    const rows = await listSyncEvents("github_copilot_billing", 1);
    expect(rows.length).toBeLessThanOrEqual(1);
  });

  it("queries are scoped to the source_type filter", async () => {
    const otherRows = await listSyncEvents("anthropic_api_usage", 100);
    const idsSet = new Set(seededIds);
    expect(otherRows.every((r) => !idsSet.has(r.id))).toBe(true);
  });
});

/**
 * Regression test for the github_members write path migration: verify that
 * any sync_events rows we seed for github_members can be discovered via the
 * same helpers (proves the source_type pipe is consistent for both flows).
 */
describe("github_members rows are discoverable via the same helpers", () => {
  let seededId: number | null = null;

  beforeAll(async () => {
    const ts = new Date(Date.now() - 5 * 60 * 1000); // 5m ago
    const [row] = await db
      .insert(syncEvents)
      .values({
        sourceType: "github_members",
        outcome: "success",
        startedAt: ts,
        completedAt: ts,
        createdCount: 2,
        updatedCount: 4,
      })
      .returning({ id: syncEvents.id });
    seededId = row.id;
  });

  afterAll(async () => {
    if (seededId != null) {
      await db.delete(syncEvents).where(eq(syncEvents.id, seededId));
    }
  });

  it("getLastCompletedSyncEvent('github_members') finds the seeded row", async () => {
    const row = await getLastCompletedSyncEvent("github_members");
    expect(row).not.toBeNull();
    expect(row?.outcome).toBe("success");
    expect(row?.createdCount).toBe(2);
    expect(row?.updatedCount).toBe(4);
  });
});
