import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb, updates, inserts } = vi.hoisted(() => {
  const updates: { payload: Record<string, unknown>; failed: boolean }[] = [];
  const inserts: Record<string, unknown>[] = [];
  let failNextUpdate = false;
  const mockDb = {
    failNextUpdate: () => {
      failNextUpdate = true;
    },
    reset: () => {
      updates.length = 0;
      inserts.length = 0;
      failNextUpdate = false;
    },
    query: {
      aiTools: { findFirst: vi.fn() },
      githubProfiles: { findMany: vi.fn() },
      accessTiers: { findMany: vi.fn() },
      licenseAssignments: { findMany: vi.fn() },
    },
    update: vi.fn(() => ({
      set: (payload: Record<string, unknown>) => ({
        where: () => {
          const failed = failNextUpdate;
          failNextUpdate = false;
          updates.push({ payload, failed });
          return failed
            ? Promise.reject(new Error("duplicate key value"))
            : Promise.resolve();
        },
      }),
    })),
    insert: vi.fn(() => ({
      values: (row: Record<string, unknown>) => {
        inserts.push(row);
        return Promise.resolve();
      },
    })),
  };
  return { mockDb, updates, inserts };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));

const { fetchCopilotSeats } = vi.hoisted(() => ({
  fetchCopilotSeats: vi.fn(),
}));
vi.mock("@/lib/copilot-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/copilot-api")>()),
  fetchCopilotSeats,
}));

import { syncSeatAssignments } from "@/lib/copilot-sync";

const seat = (id: number, login: string) => ({
  assignee: { id, login, avatar_url: "" },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  last_activity_at: null,
  last_activity_editor: null,
  plan_type: "business" as const,
  pending_cancellation_date: null,
});

describe("syncSeatAssignments: recovery from a failed seat write", () => {
  beforeEach(() => {
    mockDb.reset();
    mockDb.query.aiTools.findFirst.mockResolvedValue({ id: 1 });
    mockDb.query.accessTiers.findMany.mockResolvedValue([
      { id: 1, name: "Business", monthlyCostCents: 1900 },
    ]);
    mockDb.query.githubProfiles.findMany.mockResolvedValue([
      { githubId: 10, userId: 1 },
      { githubId: 20, userId: 2 },
    ]);
    mockDb.query.licenseAssignments.findMany.mockResolvedValue([
      // user 1: active manual row next to a stale inactive sync row; the
      // takeover update of the active row is the one we make fail.
      {
        id: 102,
        userId: 1,
        tierId: 1,
        status: "inactive",
        source: "copilot-sync",
      },
      { id: 300, userId: 1, tierId: 1, status: "active", source: "manual" },
      // user 4: an active sync seat GitHub no longer lists → must be revoked.
      {
        id: 400,
        userId: 4,
        tierId: 1,
        status: "active",
        source: "copilot-sync",
      },
    ]);
    fetchCopilotSeats.mockResolvedValue({
      data: [seat(10, "first"), seat(20, "second")],
    });
  });

  it("keeps processing later seats, still revokes, then reports the failure", async () => {
    mockDb.failNextUpdate();

    await expect(
      syncSeatAssignments({ id: 1, orgLogin: "unic" }, "token"),
    ).rejects.toThrow(
      "1 of 2 seat(s) failed to sync: seat first: duplicate key value",
    );

    // The failing takeover acted on the ACTIVE row and did not reactivate.
    expect(updates[0].failed).toBe(true);
    expect(updates[0].payload).not.toHaveProperty("status");

    // A later seat was still created.
    expect(inserts).toEqual([
      expect.objectContaining({
        userId: 2,
        status: "active",
        source: "copilot-sync",
      }),
    ]);

    // The removed seat was still revoked, and only that one.
    const revokes = updates.filter((u) => u.payload.status === "inactive");
    expect(revokes).toHaveLength(1);
    expect(revokes[0].failed).toBe(false);
  });

  it("resolves without error when every write succeeds", async () => {
    await expect(
      syncSeatAssignments({ id: 1, orgLogin: "unic" }, "token"),
    ).resolves.toEqual({ seatsProcessed: 2 });
  });
});
