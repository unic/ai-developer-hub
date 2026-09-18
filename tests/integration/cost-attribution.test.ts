import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

import { attributeRange } from "@/lib/sync/sources/anthropic-workspace";
import { BILLED_ONLY_MODEL } from "@/lib/anthropic/cost-attribution";

/**
 * The money invariants (contracts/cost-attribution.md §6), asserted against a
 * real database rather than in-memory fixtures — the SQL round trip is where a
 * pure function's guarantee can still be lost.
 *
 * Everything is seeded under a dedicated date range far in the future so the
 * suite cannot collide with real cost data, with another integration suite, or
 * with a retried run of itself.
 */

// A range no real cost data will ever occupy.
const D1 = "2099-03-01";
const D2 = "2099-03-02";
const D3 = "2099-03-03";
const RANGE_START = "2099-03-01";
const RANGE_END = "2099-03-31";

const WS_SOLO = "wrkspc_test_solo_045";
const WS_SHARED = "wrkspc_test_shared_045";
const WS_ORPHAN = "wrkspc_test_orphan_045";

let soloUserId: number;
let sharedUserAId: number;
let sharedUserBId: number;

async function seedUser(email: string): Promise<number> {
  const rows = (
    await db.execute(sql`
      INSERT INTO users (name, email, password_hash, role, status)
      VALUES ('045 attribution fixture', ${email}, 'x', 'viewer', 'inactive')
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `)
  ).rows as { id: number }[];
  return rows[0].id;
}

async function cleanup() {
  await db.execute(sql`
    DELETE FROM anthropic_usage_metrics WHERE date BETWEEN ${RANGE_START} AND ${RANGE_END}
  `);
  await db.execute(sql`
    DELETE FROM anthropic_workspace_costs WHERE date BETWEEN ${RANGE_START} AND ${RANGE_END}
  `);
  await db.execute(sql`
    DELETE FROM anthropic_workspace_cost_items WHERE date BETWEEN ${RANGE_START} AND ${RANGE_END}
  `);
  await db.execute(sql`
    DELETE FROM anthropic_workspace_owners
    WHERE workspace_id IN (${WS_SOLO}, ${WS_SHARED}, ${WS_ORPHAN})
  `);
  await db.execute(sql`
    DELETE FROM users WHERE email LIKE '045-attribution-%@fixture.invalid'
  `);
}

beforeAll(async () => {
  await cleanup();

  soloUserId = await seedUser("045-attribution-solo@fixture.invalid");
  sharedUserAId = await seedUser("045-attribution-a@fixture.invalid");
  sharedUserBId = await seedUser("045-attribution-b@fixture.invalid");

  await db.execute(sql`
    INSERT INTO anthropic_workspace_owners (workspace_id, user_id, source) VALUES
      (${WS_SOLO}, ${soloUserId}, 'resolved'),
      (${WS_SHARED}, ${sharedUserAId}, 'resolved'),
      (${WS_SHARED}, ${sharedUserBId}, 'resolved')
  `);

  // Billed cost per workspace-day.
  await db.execute(sql`
    INSERT INTO anthropic_workspace_costs (workspace_id, date, cost_cents) VALUES
      (${WS_SOLO}, ${D1}, 3283),
      (${WS_SHARED}, ${D2}, 1001),
      (${WS_ORPHAN}, ${D2}, 12662),
      (${WS_SOLO}, ${D3}, 777)
  `);

  // Per-model usage. Note D3 has NO usage row for the solo user — that is the
  // carrier-row case (R10).
  await db.execute(sql`
    INSERT INTO anthropic_usage_metrics
      (user_id, date, model, computed_cost_cents) VALUES
      (${soloUserId}, ${D1}, 'claude-opus-4', 20000),
      (${soloUserId}, ${D1}, 'claude-haiku-4-5', 4932),
      (${sharedUserAId}, ${D2}, 'claude-opus-4', 500),
      (${sharedUserAId}, ${D2}, 'claude-sonnet-4', 100),
      (${sharedUserBId}, ${D2}, 'claude-opus-4', 400)
  `);
});

afterAll(cleanup);

describe("attributeRange", () => {
  it("writes billed, apportioned and carrier rows and leaves orphans alone", async () => {
    const written = await attributeRange(RANGE_START, RANGE_END);
    expect(written).toBeGreaterThan(0);

    // I3 — a single-owner workspace's day equals its billed cost exactly, and
    // the price table never enters into it (the computed figure was 24932).
    const solo = (
      await db.execute(sql`
        SELECT sum(attributed_cost_cents)::int AS cents,
               count(DISTINCT attribution_mode) AS modes,
               min(attribution_mode::text) AS mode
        FROM anthropic_usage_metrics
        WHERE user_id = ${soloUserId} AND date = ${D1}
      `)
    ).rows[0] as { cents: number; modes: number; mode: string };

    expect(solo.cents).toBe(3283);
    expect(solo.mode).toBe("billed");
    expect(Number(solo.modes)).toBe(1);

    // I3a — the per-model parts sum to the day, so no cent is lost in storage.
    const perModel = (
      await db.execute(sql`
        SELECT model, attributed_cost_cents AS cents
        FROM anthropic_usage_metrics
        WHERE user_id = ${soloUserId} AND date = ${D1}
        ORDER BY model
      `)
    ).rows as { model: string; cents: number }[];

    expect(perModel).toHaveLength(2);
    expect(perModel.reduce((s, r) => s + r.cents, 0)).toBe(3283);
    // Weighted by computed cost: opus carried ~80% of it.
    expect(perModel.find((r) => r.model === "claude-opus-4")!.cents).toBe(2634);

    // I1/I2 — a shared workspace's day is split across its owners and sums to
    // the billed total, with neither owner exceeding it.
    const shared = (
      await db.execute(sql`
        SELECT user_id, sum(attributed_cost_cents)::int AS cents,
               min(attribution_mode::text) AS mode
        FROM anthropic_usage_metrics
        WHERE user_id IN (${sharedUserAId}, ${sharedUserBId}) AND date = ${D2}
        GROUP BY user_id ORDER BY user_id
      `)
    ).rows as { user_id: number; cents: number; mode: string }[];

    expect(shared).toHaveLength(2);
    expect(shared.reduce((s, r) => s + r.cents, 0)).toBe(1001);
    expect(shared.every((r) => r.mode === "apportioned")).toBe(true);
    expect(shared.every((r) => r.cents <= 1001)).toBe(true);
    // 600:400 of the computed weight, largest remainder on the odd cent.
    expect(shared.map((r) => r.cents).sort((a, b) => b - a)).toEqual([601, 400]);

    // R10 — billed cost with no usage row gets a carrier row, not silence.
    const carrier = (
      await db.execute(sql`
        SELECT model, attributed_cost_cents AS cents, computed_cost_cents AS computed
        FROM anthropic_usage_metrics
        WHERE user_id = ${soloUserId} AND date = ${D3}
      `)
    ).rows as { model: string; cents: number; computed: number }[];

    expect(carrier).toEqual([
      { model: BILLED_ONLY_MODEL, cents: 777, computed: 0 },
    ]);

    // FR-007 — an unowned workspace's spend is attributed to nobody. It stays
    // in anthropic_workspace_costs, visible at org level.
    const orphanBilled = (
      await db.execute(sql`
        SELECT cost_cents FROM anthropic_workspace_costs
        WHERE workspace_id = ${WS_ORPHAN} AND date = ${D2}
      `)
    ).rows[0] as { cost_cents: number };
    expect(orphanBilled.cost_cents).toBe(12662);
  });

  it("is idempotent — a second run reproduces the same figures", async () => {
    const before = (
      await db.execute(sql`
        SELECT coalesce(sum(attributed_cost_cents), 0)::int AS total,
               count(*)::int AS rows
        FROM anthropic_usage_metrics WHERE date BETWEEN ${RANGE_START} AND ${RANGE_END}
      `)
    ).rows[0] as { total: number; rows: number };

    await attributeRange(RANGE_START, RANGE_END);

    const after = (
      await db.execute(sql`
        SELECT coalesce(sum(attributed_cost_cents), 0)::int AS total,
               count(*)::int AS rows
        FROM anthropic_usage_metrics WHERE date BETWEEN ${RANGE_START} AND ${RANGE_END}
      `)
    ).rows[0] as { total: number; rows: number };

    expect(after).toEqual(before);
  });

  it("follows an ownership correction without re-syncing Anthropic (I4)", async () => {
    // Hand the solo workspace to a different user, as an admin override would.
    await db.execute(sql`
      DELETE FROM anthropic_workspace_owners
      WHERE workspace_id = ${WS_SOLO} AND user_id = ${soloUserId}
    `);
    await db.execute(sql`
      INSERT INTO anthropic_workspace_owners (workspace_id, user_id, source)
      VALUES (${WS_SOLO}, ${sharedUserAId}, 'manual')
    `);
    await db.execute(sql`
      INSERT INTO anthropic_usage_metrics (user_id, date, model, computed_cost_cents)
      VALUES (${sharedUserAId}, ${D1}, 'claude-opus-4', 10)
    `);

    await attributeRange(RANGE_START, RANGE_END);

    const previousOwner = (
      await db.execute(sql`
        SELECT coalesce(sum(attributed_cost_cents), 0)::int AS cents
        FROM anthropic_usage_metrics WHERE user_id = ${soloUserId} AND date = ${D1}
      `)
    ).rows[0] as { cents: number };
    const newOwner = (
      await db.execute(sql`
        SELECT coalesce(sum(attributed_cost_cents), 0)::int AS cents
        FROM anthropic_usage_metrics WHERE user_id = ${sharedUserAId} AND date = ${D1}
      `)
    ).rows[0] as { cents: number };

    // The stale figure is cleared, not left behind.
    expect(previousOwner.cents).toBe(0);
    expect(newOwner.cents).toBe(3283);

    // Restore for any later run.
    await db.execute(sql`
      DELETE FROM anthropic_workspace_owners
      WHERE workspace_id = ${WS_SOLO} AND user_id = ${sharedUserAId}
    `);
    await db.execute(sql`
      INSERT INTO anthropic_workspace_owners (workspace_id, user_id, source)
      VALUES (${WS_SOLO}, ${soloUserId}, 'resolved')
    `);
  });
});
