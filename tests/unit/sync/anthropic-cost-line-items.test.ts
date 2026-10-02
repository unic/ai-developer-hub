import { describe, it, expect } from "vitest";

// Pure aggregators — no DB / network mocks needed.
import fixture from "../../fixtures/anthropic-cost-report-2026-09-01.json";
import {
  aggregateCostLineItems,
  aggregateDailyCosts,
  rollUpLineItems,
} from "@/lib/sync/sources/anthropic-workspace";

type Bucket = Parameters<typeof aggregateCostLineItems>[0][number];
type Result = Bucket["results"][number];

function bucket(startingAt: string, results: Partial<Result>[]): Bucket {
  return {
    starting_at: startingAt,
    ending_at: startingAt, // Not read by the aggregators
    results: results.map((r) => ({ amount: "0", ...r })) as Result[],
  };
}

describe("aggregateCostLineItems", () => {
  it("keeps one row per grain and stores micro-cents", () => {
    const rows = aggregateCostLineItems([
      bucket("2026-09-01T00:00:00Z", [
        {
          workspace_id: "ws1",
          amount: "143.569125",
          model: "claude-opus-4-20250514",
          cost_type: "tokens",
          token_type: "uncached_input_tokens",
          context_window: "0-200k",
          service_tier: "standard",
          inference_geo: "global",
        },
      ]),
    ]);

    expect(rows).toEqual([
      {
        workspaceId: "ws1",
        date: "2026-09-01",
        model: "claude-opus-4-20250514",
        costType: "tokens",
        tokenType: "uncached_input_tokens",
        contextWindow: "0-200k",
        serviceTier: "standard",
        inferenceGeo: "global",
        costMicrocents: 143_569_125,
      },
    ]);
  });

  it("does not collide two rows that differ only by inference_geo", () => {
    // A live sample has Haiku 4.5 on `not_available` beside `global` rows for
    // the same workspace-day. Collapsing them would silently drop one.
    const rows = aggregateCostLineItems([
      bucket("2026-09-01T00:00:00Z", [
        {
          workspace_id: "ws1",
          amount: "100.0",
          model: "claude-haiku-4-5",
          inference_geo: "global",
        },
        {
          workspace_id: "ws1",
          amount: "250.0",
          model: "claude-haiku-4-5",
          inference_geo: "not_available",
        },
      ]),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.costMicrocents).sort((a, b) => a - b)).toEqual([
      100_000_000, 250_000_000,
    ]);
  });

  it("sums rows that share the full grain", () => {
    const rows = aggregateCostLineItems([
      bucket("2026-09-01T00:00:00Z", [
        { workspace_id: "ws1", amount: "10.5", model: "m", token_type: "t" },
        { workspace_id: "ws1", amount: "20.25", model: "m", token_type: "t" },
      ]),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].costMicrocents).toBe(30_750_000);
  });

  it("carries a null workspace_id (default workspace) through as null", () => {
    const rows = aggregateCostLineItems([
      bucket("2026-09-01T00:00:00Z", [
        { workspace_id: null, amount: "5.0", model: "m" },
      ]),
    ]);

    expect(rows[0].workspaceId).toBeNull();
  });

  it("carries a null model for non-token cost types", () => {
    // web_search / code_execution rows have no model.
    const rows = aggregateCostLineItems([
      bucket("2026-09-01T00:00:00Z", [
        { workspace_id: "ws1", amount: "12.0", cost_type: "web_search" },
        { workspace_id: "ws1", amount: "8.0", cost_type: "code_execution" },
      ]),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.model === null)).toBe(true);
    expect(rows.map((r) => r.costType).sort()).toEqual([
      "code_execution",
      "web_search",
    ]);
  });
});

describe("rollUpLineItems", () => {
  it("rounds once at the aggregate, not per line item", () => {
    // Six items of 0.4 cents each: the true total is 2.4 cents => 2 cents.
    // Rounding each item first would give 0 six times => 0 cents.
    const rows = rollUpLineItems(
      Array.from({ length: 6 }, (_, i) => ({
        workspaceId: "ws1",
        date: "2026-09-01",
        model: `m${i}`,
        costType: "tokens",
        tokenType: null,
        contextWindow: null,
        serviceTier: null,
        inferenceGeo: null,
        costMicrocents: 400_000,
      })),
    );

    expect(rows).toEqual([
      { workspaceId: "ws1", date: "2026-09-01", costCents: 2 },
    ]);
  });

  it("separates the default workspace from named ones", () => {
    const rows = rollUpLineItems([
      {
        workspaceId: null,
        date: "2026-09-01",
        model: null,
        costType: null,
        tokenType: null,
        contextWindow: null,
        serviceTier: null,
        inferenceGeo: null,
        costMicrocents: 1_000_000,
      },
      {
        workspaceId: "ws1",
        date: "2026-09-01",
        model: null,
        costType: null,
        tokenType: null,
        contextWindow: null,
        serviceTier: null,
        inferenceGeo: null,
        costMicrocents: 2_000_000,
      },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.workspaceId === null)?.costCents).toBe(1);
    expect(rows.find((r) => r.workspaceId === "ws1")?.costCents).toBe(2);
  });
});

describe("aggregateDailyCosts is derived from the line items", () => {
  // The real cost_report response for 2026-09-01..02, captured 2026-09-18 with
  // group_by[]=workspace_id&group_by[]=description. 38 line items on the 1st
  // across 4 workspaces, 36 on the 2nd — the days the dashboard shows as
  // $29.28 and $8.86.
  const sample = fixture as Bucket[];
  const day = (d: string) =>
    sample.filter((b) => b.starting_at.startsWith(d));

  it("rolls the captured sample up to the figures the dashboard shows", () => {
    const first = day("2026-09-01");
    const second = day("2026-09-02");

    expect(aggregateCostLineItems(first)).toHaveLength(38);
    expect(aggregateCostLineItems(second)).toHaveLength(36);

    const total = (buckets: Bucket[]) =>
      aggregateDailyCosts(buckets).reduce((sum, r) => sum + r.costCents, 0);

    expect(total(first)).toBe(2928); // $29.28
    expect(total(second)).toBe(886); // $8.86
  });

  it("would have drifted by 2 cents had each line item been rounded first", () => {
    // The regression this guards: Math.round(parseFloat(amount)) per row,
    // which is what the sync did before line items existed.
    const first = day("2026-09-01");
    const perRowRounded = first
      .flatMap((b) => b.results)
      .reduce((sum, r) => sum + Math.round(parseFloat(r.amount)), 0);

    expect(perRowRounded).toBe(2926);
    expect(
      aggregateDailyCosts(first).reduce((sum, r) => sum + r.costCents, 0),
    ).toBe(2928);
  });

  it("keeps the real not_available rows apart from the global ones", () => {
    // Not hypothetical: in this sample claude-haiku-4-5 reports
    // `not_available` while every other model on the same workspace-day
    // reports `global`. Leaving inference_geo out of the grain would let a
    // future workspace-day collide two genuinely different rows.
    const items = aggregateCostLineItems(day("2026-09-01"));

    expect(new Set(items.map((i) => i.inferenceGeo))).toEqual(
      new Set(["global", "not_available"]),
    );
    expect(
      new Set(
        items.filter((i) => i.inferenceGeo === "not_available").map((i) => i.model),
      ),
    ).toEqual(new Set(["claude-haiku-4-5-20251001"]));

    // Every row is a distinct point of the grain — nothing was merged away.
    const keys = items.map((i) =>
      [
        i.workspaceId,
        i.model,
        i.costType,
        i.tokenType,
        i.contextWindow,
        i.serviceTier,
        i.inferenceGeo,
      ].join("|"),
    );
    expect(new Set(keys).size).toBe(items.length);

    // At least one workspace-day carries both geos side by side.
    const byWorkspace = new Map<string | null, Set<string | null>>();
    for (const i of items) {
      const geos = byWorkspace.get(i.workspaceId) ?? new Set();
      geos.add(i.inferenceGeo);
      byWorkspace.set(i.workspaceId, geos);
    }
    expect([...byWorkspace.values()].some((geos) => geos.size > 1)).toBe(true);
  });
});
