import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

describe("Workspace cost sync idempotency", () => {
  const testWorkspaceId = "test-ws-idempotent-" + Date.now();
  const testDate = "2020-01-01"; // Far past to avoid conflicts
  const testDateNull = "2020-01-02"; // Separate date for null workspace tests
  const perDayWorkspaceId = "test-ws-per-day-" + Date.now();
  const perDayDates = ["2020-02-01", "2020-02-02", "2020-02-03"];

  afterAll(async () => {
    // Cleanup test data
    await db.execute(
      sql`DELETE FROM anthropic_workspace_costs WHERE workspace_id = ${testWorkspaceId}`
    );
    await db.execute(
      sql`DELETE FROM anthropic_workspace_costs WHERE workspace_id IS NULL AND date = ${testDateNull}`
    );
    await db.execute(
      sql`DELETE FROM anthropic_workspace_costs WHERE workspace_id = ${perDayWorkspaceId}`
    );
  });

  it("updates existing row in-place on re-sync for named workspace", async () => {
    // First insert
    await db.execute(sql`
      INSERT INTO anthropic_workspace_costs (workspace_id, date, cost_cents)
      VALUES (${testWorkspaceId}, ${testDate}, ${100})
      ON CONFLICT (workspace_id, date) WHERE workspace_id IS NOT NULL
      DO UPDATE SET cost_cents = ${100}, updated_at = now()
    `);

    // Verify row exists
    const rows1 = await db.execute(
      sql`SELECT cost_cents FROM anthropic_workspace_costs WHERE workspace_id = ${testWorkspaceId} AND date = ${testDate}`
    );
    expect(rows1.rows).toHaveLength(1);
    expect(rows1.rows[0].cost_cents).toBe(100);

    // Second insert with different cost (simulates re-sync)
    await db.execute(sql`
      INSERT INTO anthropic_workspace_costs (workspace_id, date, cost_cents)
      VALUES (${testWorkspaceId}, ${testDate}, ${200})
      ON CONFLICT (workspace_id, date) WHERE workspace_id IS NOT NULL
      DO UPDATE SET cost_cents = ${200}, updated_at = now()
    `);

    // Verify still one row, updated cost
    const rows2 = await db.execute(
      sql`SELECT cost_cents FROM anthropic_workspace_costs WHERE workspace_id = ${testWorkspaceId} AND date = ${testDate}`
    );
    expect(rows2.rows).toHaveLength(1);
    expect(rows2.rows[0].cost_cents).toBe(200);
  });

  it("does not create duplicate rows for same workspace+date", async () => {
    // Run upsert 3 times with increasing costs
    for (const cost of [300, 400, 500]) {
      await db.execute(sql`
        INSERT INTO anthropic_workspace_costs (workspace_id, date, cost_cents)
        VALUES (${testWorkspaceId}, ${testDate}, ${cost})
        ON CONFLICT (workspace_id, date) WHERE workspace_id IS NOT NULL
        DO UPDATE SET cost_cents = ${cost}, updated_at = now()
      `);
    }

    const rows = await db.execute(
      sql`SELECT cost_cents FROM anthropic_workspace_costs WHERE workspace_id = ${testWorkspaceId} AND date = ${testDate}`
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].cost_cents).toBe(500); // Last write wins
  });

  it("stores one row per (workspace_id, date) for a multi-day sync", async () => {
    // Simulate the fixed sync writing per-day rows for the same workspace
    // across three consecutive days.
    for (const [i, date] of perDayDates.entries()) {
      const cents = (i + 1) * 100; // 100, 200, 300
      await db.execute(sql`
        INSERT INTO anthropic_workspace_costs (workspace_id, date, cost_cents)
        VALUES (${perDayWorkspaceId}, ${date}, ${cents})
        ON CONFLICT (workspace_id, date) WHERE workspace_id IS NOT NULL
        DO UPDATE SET cost_cents = ${cents}, updated_at = now()
      `);
    }

    const rows = await db.execute(
      sql`SELECT date::text AS date, cost_cents FROM anthropic_workspace_costs
          WHERE workspace_id = ${perDayWorkspaceId}
          ORDER BY date ASC`
    );

    expect(rows.rows).toHaveLength(3);
    expect(rows.rows.map((r) => r.date)).toEqual(perDayDates);
    expect(rows.rows.map((r) => Number(r.cost_cents))).toEqual([100, 200, 300]);

    // Re-running the same upserts must not produce duplicates or change values.
    for (const [i, date] of perDayDates.entries()) {
      const cents = (i + 1) * 100;
      await db.execute(sql`
        INSERT INTO anthropic_workspace_costs (workspace_id, date, cost_cents)
        VALUES (${perDayWorkspaceId}, ${date}, ${cents})
        ON CONFLICT (workspace_id, date) WHERE workspace_id IS NOT NULL
        DO UPDATE SET cost_cents = ${cents}, updated_at = now()
      `);
    }

    const rerunRows = await db.execute(
      sql`SELECT COUNT(*)::int AS count FROM anthropic_workspace_costs
          WHERE workspace_id = ${perDayWorkspaceId}`
    );
    expect(Number(rerunRows.rows[0].count)).toBe(3);
  });

  it("handles default workspace (null workspace_id) upsert correctly", async () => {
    // First insert for default workspace
    await db.execute(sql`
      INSERT INTO anthropic_workspace_costs (workspace_id, date, cost_cents)
      VALUES (NULL, ${testDateNull}, ${150})
      ON CONFLICT (date) WHERE workspace_id IS NULL
      DO UPDATE SET cost_cents = ${150}, updated_at = now()
    `);

    const rows1 = await db.execute(
      sql`SELECT cost_cents FROM anthropic_workspace_costs WHERE workspace_id IS NULL AND date = ${testDateNull}`
    );
    expect(rows1.rows).toHaveLength(1);
    expect(rows1.rows[0].cost_cents).toBe(150);

    // Re-sync with updated cost
    await db.execute(sql`
      INSERT INTO anthropic_workspace_costs (workspace_id, date, cost_cents)
      VALUES (NULL, ${testDateNull}, ${250})
      ON CONFLICT (date) WHERE workspace_id IS NULL
      DO UPDATE SET cost_cents = ${250}, updated_at = now()
    `);

    const rows2 = await db.execute(
      sql`SELECT cost_cents FROM anthropic_workspace_costs WHERE workspace_id IS NULL AND date = ${testDateNull}`
    );
    expect(rows2.rows).toHaveLength(1);
    expect(rows2.rows[0].cost_cents).toBe(250);
  });
});
