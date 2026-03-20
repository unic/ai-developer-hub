import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for src/actions/alerts.ts → computeActiveAlerts
 *
 * Tests:
 * 1. utilizationPct=79 → no alert
 * 2. utilizationPct=80 → "warning" alert
 * 3. utilizationPct=100 → "critical" alert
 * 4. creditsLow and creditsCritical are always false
 */

// ── Hoisted shared state ──────────────────────────────────────────────────────

const { mockExecute } = vi.hoisted(() => {
  const mockExecute = vi.fn();
  return { mockExecute };
});

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    execute: mockExecute,
  },
}));

vi.mock("next/cache", () => ({
  unstable_cache: vi.fn(
    // Pass the wrapped function through so we can call it directly in tests
    (fn: (...args: unknown[]) => unknown) => fn
  ),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { getActiveAlerts } from "@/actions/alerts";

// ── Helpers ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Build a fake DB result set for one workspace row.
 */
function makeRow(opts: {
  workspace_id: string | null;
  name: string;
  current_month_cents: number;
  limit_cents: number | null;
}) {
  return {
    workspace_id: opts.workspace_id,
    name: opts.name,
    current_month_cents: opts.current_month_cents,
    limit_cents: opts.limit_cents,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getActiveAlerts — workspace utilization thresholds", () => {
  it("does not create an alert when utilizationPct is 79 (below 80 threshold)", async () => {
    // 79 cents spent out of 100 cents limit → 79%
    mockExecute.mockResolvedValueOnce({
      rows: [makeRow({ workspace_id: "ws_1", name: "Workspace A", current_month_cents: 79, limit_cents: 100 })],
    });

    const result = await getActiveAlerts();

    expect(result.workspaceAlerts).toHaveLength(0);
  });

  it("creates a 'warning' alert when utilizationPct is exactly 80", async () => {
    // 80 cents spent out of 100 cents limit → 80%
    mockExecute.mockResolvedValueOnce({
      rows: [makeRow({ workspace_id: "ws_2", name: "Workspace B", current_month_cents: 80, limit_cents: 100 })],
    });

    const result = await getActiveAlerts();

    expect(result.workspaceAlerts).toHaveLength(1);
    expect(result.workspaceAlerts[0].severity).toBe("warning");
    expect(result.workspaceAlerts[0].utilizationPct).toBe(80);
    expect(result.workspaceAlerts[0].name).toBe("Workspace B");
  });

  it("creates a 'warning' alert when utilizationPct is 99", async () => {
    // 99 cents spent out of 100 cents limit → 99%
    mockExecute.mockResolvedValueOnce({
      rows: [makeRow({ workspace_id: "ws_3", name: "Workspace C", current_month_cents: 99, limit_cents: 100 })],
    });

    const result = await getActiveAlerts();

    expect(result.workspaceAlerts).toHaveLength(1);
    expect(result.workspaceAlerts[0].severity).toBe("warning");
    expect(result.workspaceAlerts[0].utilizationPct).toBe(99);
  });

  it("creates a 'critical' alert when utilizationPct is exactly 100", async () => {
    // 100 cents spent out of 100 cents limit → 100%
    mockExecute.mockResolvedValueOnce({
      rows: [makeRow({ workspace_id: "ws_4", name: "Workspace D", current_month_cents: 100, limit_cents: 100 })],
    });

    const result = await getActiveAlerts();

    expect(result.workspaceAlerts).toHaveLength(1);
    expect(result.workspaceAlerts[0].severity).toBe("critical");
    expect(result.workspaceAlerts[0].utilizationPct).toBe(100);
    expect(result.workspaceAlerts[0].name).toBe("Workspace D");
  });

  it("creates a 'critical' alert when utilizationPct is above 100", async () => {
    // 150 cents spent out of 100 cents limit → 150%
    mockExecute.mockResolvedValueOnce({
      rows: [makeRow({ workspace_id: "ws_5", name: "Workspace E", current_month_cents: 150, limit_cents: 100 })],
    });

    const result = await getActiveAlerts();

    expect(result.workspaceAlerts).toHaveLength(1);
    expect(result.workspaceAlerts[0].severity).toBe("critical");
    expect(result.workspaceAlerts[0].utilizationPct).toBe(150);
  });
});

describe("getActiveAlerts — credit flags", () => {
  it("always returns creditsLow: false", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const result = await getActiveAlerts();

    expect(result.creditsLow).toBe(false);
  });

  it("always returns creditsCritical: false", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const result = await getActiveAlerts();

    expect(result.creditsCritical).toBe(false);
  });
});

describe("getActiveAlerts — edge cases", () => {
  it("skips workspaces with null limit_cents", async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [makeRow({ workspace_id: "ws_no_limit", name: "No Limit WS", current_month_cents: 500, limit_cents: null })],
    });

    const result = await getActiveAlerts();

    // No limit set → no alert should be generated
    expect(result.workspaceAlerts).toHaveLength(0);
  });

  it("skips workspaces with limit_cents <= 0", async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [makeRow({ workspace_id: "ws_zero", name: "Zero Limit WS", current_month_cents: 0, limit_cents: 0 })],
    });

    const result = await getActiveAlerts();

    expect(result.workspaceAlerts).toHaveLength(0);
  });

  it("returns empty workspaceAlerts when there are no workspace rows", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const result = await getActiveAlerts();

    expect(result.workspaceAlerts).toHaveLength(0);
  });

  it("handles multiple workspaces with mixed alert levels", async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [
        makeRow({ workspace_id: "ws_ok", name: "OK", current_month_cents: 50, limit_cents: 100 }), // 50% — no alert
        makeRow({ workspace_id: "ws_warn", name: "Warn", current_month_cents: 85, limit_cents: 100 }), // 85% — warning
        makeRow({ workspace_id: "ws_crit", name: "Crit", current_month_cents: 105, limit_cents: 100 }), // 105% — critical
      ],
    });

    const result = await getActiveAlerts();

    expect(result.workspaceAlerts).toHaveLength(2);
    const warnAlert = result.workspaceAlerts.find((a) => a.name === "Warn");
    const critAlert = result.workspaceAlerts.find((a) => a.name === "Crit");
    expect(warnAlert?.severity).toBe("warning");
    expect(critAlert?.severity).toBe("critical");
  });
});
