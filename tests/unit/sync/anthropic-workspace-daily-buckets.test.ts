import { describe, it, expect } from "vitest";

// The aggregator is a pure function — no DB / network mocks needed.
import { aggregateDailyCosts } from "@/lib/sync/sources/anthropic-workspace";

type Bucket = Parameters<typeof aggregateDailyCosts>[0][number];

function bucket(
  startingAt: string,
  results: Array<{ workspace_id: string | null; amount: string }>
): Bucket {
  return {
    starting_at: startingAt,
    ending_at: startingAt, // Not used by aggregator
    results: results.map((r) => ({
      workspace_id: r.workspace_id,
      amount: r.amount,
    })),
  };
}

describe("aggregateDailyCosts", () => {
  it("returns one row per (workspace, day) for multi-day buckets", () => {
    const buckets: Bucket[] = [
      bucket("2026-05-01T00:00:00Z", [
        { workspace_id: "ws1", amount: "100.00" },
        { workspace_id: "ws2", amount: "50.00" },
      ]),
      bucket("2026-05-02T00:00:00Z", [
        { workspace_id: "ws1", amount: "200.00" },
        { workspace_id: "ws2", amount: "75.00" },
      ]),
      bucket("2026-05-03T00:00:00Z", [
        { workspace_id: "ws1", amount: "300.00" },
      ]),
    ];

    const rows = aggregateDailyCosts(buckets);

    expect(rows).toHaveLength(5);
    expect(rows).toEqual(
      expect.arrayContaining([
        { workspaceId: "ws1", date: "2026-05-01", costCents: 100 },
        { workspaceId: "ws2", date: "2026-05-01", costCents: 50 },
        { workspaceId: "ws1", date: "2026-05-02", costCents: 200 },
        { workspaceId: "ws2", date: "2026-05-02", costCents: 75 },
        { workspaceId: "ws1", date: "2026-05-03", costCents: 300 },
      ])
    );
  });

  it("sums multiple result rows for the same workspace within a single bucket", () => {
    // Anthropic may split a workspace's cost across multiple result rows
    // (e.g., by cost_type) inside the same daily bucket.
    const buckets: Bucket[] = [
      bucket("2026-05-01T00:00:00Z", [
        { workspace_id: "ws1", amount: "10.50" },
        { workspace_id: "ws1", amount: "20.25" },
        { workspace_id: "ws1", amount: "5.00" },
      ]),
    ];

    const rows = aggregateDailyCosts(buckets);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      workspaceId: "ws1",
      date: "2026-05-01",
      // 10.50 + 20.25 + 5.00 = 35.75 → 36 after rounding each separately:
      // Math.round(10.50)=11, Math.round(20.25)=20, Math.round(5.00)=5 → 36
      costCents: 36,
    });
  });

  it("routes null workspace_id to the default-workspace bucket", () => {
    const buckets: Bucket[] = [
      bucket("2026-05-01T00:00:00Z", [
        { workspace_id: null, amount: "42.00" },
        { workspace_id: "ws1", amount: "100.00" },
      ]),
      bucket("2026-05-02T00:00:00Z", [
        { workspace_id: null, amount: "8.00" },
      ]),
    ];

    const rows = aggregateDailyCosts(buckets);

    expect(rows).toHaveLength(3);
    const defaults = rows.filter((r) => r.workspaceId === null);
    expect(defaults).toHaveLength(2);
    expect(defaults).toEqual(
      expect.arrayContaining([
        { workspaceId: null, date: "2026-05-01", costCents: 42 },
        { workspaceId: null, date: "2026-05-02", costCents: 8 },
      ])
    );
  });

  it("keeps null-workspace and named-workspace entries separate on the same day", () => {
    const buckets: Bucket[] = [
      bucket("2026-05-01T00:00:00Z", [
        { workspace_id: null, amount: "10.00" },
        { workspace_id: "ws1", amount: "20.00" },
      ]),
    ];

    const rows = aggregateDailyCosts(buckets);

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { workspaceId: null, date: "2026-05-01", costCents: 10 },
        { workspaceId: "ws1", date: "2026-05-01", costCents: 20 },
      ])
    );
  });

  it("returns an empty array when no buckets are provided", () => {
    expect(aggregateDailyCosts([])).toEqual([]);
  });

  it("returns an empty array when buckets have no results", () => {
    const buckets: Bucket[] = [
      bucket("2026-05-01T00:00:00Z", []),
      bucket("2026-05-02T00:00:00Z", []),
    ];
    expect(aggregateDailyCosts(buckets)).toEqual([]);
  });

  it("derives date as the UTC calendar date from starting_at", () => {
    // starting_at is RFC3339 UTC; we take the first 10 chars (YYYY-MM-DD).
    // Aliasing here protects against accidental local-TZ conversions.
    const buckets: Bucket[] = [
      bucket("2026-05-15T23:59:59Z", [
        { workspace_id: "ws1", amount: "1.00" },
      ]),
    ];

    const rows = aggregateDailyCosts(buckets);
    expect(rows[0].date).toBe("2026-05-15");
  });
});
