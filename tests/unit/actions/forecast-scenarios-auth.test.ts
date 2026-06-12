import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockRequireAdmin, mockDb } = vi.hoisted(() => {
  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    query: { forecastScenarios: { findFirst: vi.fn() } },
  };
  return { mockRequireAdmin: vi.fn(), mockDb };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/auth-helpers", () => ({ requireAdmin: mockRequireAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/actions/history", () => ({
  recordCreation: vi.fn(),
  recordUpdate: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  createForecastScenario,
  deleteForecastScenario,
  listForecastScenarios,
  updateForecastScenario,
} from "@/actions/forecast-scenarios";

/**
 * Auth-gating contract for the saved-forecast-scenario actions (spec 041):
 * with no admin session, the read degrades to [] (defense-in-depth — the
 * /scenarios layout redirects first) and every mutation returns the
 * ActionResult failure shape. The DB must never be touched.
 */
describe("forecast-scenario actions without an admin session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdmin.mockResolvedValue(null);
  });

  it("listForecastScenarios returns []", async () => {
    expect(await listForecastScenarios()).toEqual([]);
  });

  it("createForecastScenario returns Unauthorized", async () => {
    expect(await createForecastScenario({ name: "x", params: {} })).toEqual({
      success: false,
      error: "Unauthorized",
    });
  });

  it("updateForecastScenario returns Unauthorized", async () => {
    expect(await updateForecastScenario({ id: 1, name: "x" })).toEqual({
      success: false,
      error: "Unauthorized",
    });
  });

  it("deleteForecastScenario returns Unauthorized", async () => {
    expect(await deleteForecastScenario(1)).toEqual({
      success: false,
      error: "Unauthorized",
    });
  });

  it("never touches the database", async () => {
    await listForecastScenarios();
    await createForecastScenario({ name: "x", params: {} });
    await updateForecastScenario({ id: 1, name: "x" });
    await deleteForecastScenario(1);
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mockDb.query.forecastScenarios.findFirst).not.toHaveBeenCalled();
  });
});
