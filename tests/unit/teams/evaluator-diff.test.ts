import { describe, expect, it } from "vitest";
import { computeAlertDiff } from "@/lib/teams/evaluator";
import type { WorkspaceForecast } from "@/lib/anthropic/forecast-workspace";
import type { AlertStateRow } from "@/lib/teams/types";
import type { WorkspaceListItem } from "@/types";

const now = new Date("2026-05-21T14:00:00Z");
const month = "2026-05";

function ws(over: Partial<WorkspaceListItem> = {}): WorkspaceListItem {
  return {
    workspaceId: "ws-1",
    name: "ws-one",
    isDefault: false,
    isArchived: false,
    currentMonthCents: 0,
    limitCents: 1_000_00,
    utilizationPct: 0,
    displayColor: null,
    todayEstimate: null,
    ...over,
  };
}

function priorRow(over: Partial<AlertStateRow> = {}): AlertStateRow {
  return {
    workspaceId: "ws-1",
    billingMonth: month,
    threshold80FiredAt: null,
    threshold100FiredAt: null,
    threshold120FiredAt: null,
    forecastAtRisk: false,
    forecastChangedAt: null,
    ...over,
  };
}

const ONTRACK: WorkspaceForecast = {
  runRate7dCents: 100,
  runRate30dCents: 100,
  runRateWoWPct: null,
  projectedMonthEndCents: 100,
  crossesCapOn: null,
  status: "on_track",
};
const ATRISK: WorkspaceForecast = { ...ONTRACK, status: "at_risk" };

describe("computeAlertDiff — thresholds", () => {
  it("emits no card for a workspace below 80%", () => {
    const diff = computeAlertDiff({
      workspaces: [ws({ utilizationPct: 79, currentMonthCents: 79_000 })],
      forecasts: new Map([["ws-1", ONTRACK]]),
      priorState: [],
      month,
      now,
    });
    expect(diff.thresholdsToFire).toHaveLength(0);
    expect(diff.rowsToUpsert).toHaveLength(0);
  });

  it("fires threshold_80 the first time a workspace crosses 85%", () => {
    const diff = computeAlertDiff({
      workspaces: [ws({ utilizationPct: 85, currentMonthCents: 85_000 })],
      forecasts: new Map([["ws-1", ONTRACK]]),
      priorState: [],
      month,
      now,
    });
    expect(diff.thresholdsToFire).toEqual([
      { workspaceId: "ws-1", threshold: "threshold_80" },
    ]);
    expect(diff.rowsToUpsert[0].threshold80FiredAt).toBe(now);
  });

  it("does NOT re-fire threshold_80 if it already fired this month", () => {
    const prior = priorRow({ threshold80FiredAt: new Date("2026-05-15T00:00:00Z") });
    const diff = computeAlertDiff({
      workspaces: [ws({ utilizationPct: 85, currentMonthCents: 85_000 })],
      forecasts: new Map([["ws-1", ONTRACK]]),
      priorState: [prior],
      month,
      now,
    });
    expect(diff.thresholdsToFire).toHaveLength(0);
    expect(diff.rowsToUpsert).toHaveLength(0);
  });

  it("fires BOTH threshold_80 and threshold_100 when crossing 0% → 105% in one tick", () => {
    const diff = computeAlertDiff({
      workspaces: [ws({ utilizationPct: 105, currentMonthCents: 105_000 })],
      forecasts: new Map([["ws-1", ONTRACK]]),
      priorState: [],
      month,
      now,
    });
    const fires = diff.thresholdsToFire.map((f) => f.threshold).sort();
    expect(fires).toEqual(["threshold_100", "threshold_80"]);
  });

  it("does NOT re-fire after a workspace falls below 80% and rises again", () => {
    const prior = priorRow({ threshold80FiredAt: new Date("2026-05-01T00:00:00Z") });
    // Workspace fell to 60%, now back to 85%.
    const diff = computeAlertDiff({
      workspaces: [ws({ utilizationPct: 85, currentMonthCents: 85_000 })],
      forecasts: new Map([["ws-1", ONTRACK]]),
      priorState: [prior],
      month,
      now,
    });
    expect(diff.thresholdsToFire).toHaveLength(0);
  });

  it("skips threshold evaluation for workspaces with no limit", () => {
    const diff = computeAlertDiff({
      workspaces: [ws({ limitCents: null, utilizationPct: null, currentMonthCents: 999_000 })],
      forecasts: new Map([["ws-1", ONTRACK]]),
      priorState: [],
      month,
      now,
    });
    expect(diff.thresholdsToFire).toHaveLength(0);
  });

  it("skips archived workspaces entirely", () => {
    const diff = computeAlertDiff({
      workspaces: [ws({ isArchived: true, utilizationPct: 999, currentMonthCents: 999_000 })],
      forecasts: new Map([["ws-1", ONTRACK]]),
      priorState: [],
      month,
      now,
    });
    expect(diff.thresholdsToFire).toHaveLength(0);
    expect(diff.rowsToUpsert).toHaveLength(0);
  });
});

describe("computeAlertDiff — forecast edges", () => {
  it("emits edge card when forecast flips on_track → at_risk", () => {
    const diff = computeAlertDiff({
      workspaces: [ws({ utilizationPct: 60, currentMonthCents: 60_000 })],
      forecasts: new Map([["ws-1", ATRISK]]),
      priorState: [priorRow({ forecastAtRisk: false })],
      month,
      now,
    });
    expect(diff.forecastEdges).toEqual([{ workspaceId: "ws-1", nextValue: true }]);
    expect(diff.rowsToUpsert[0].forecastAtRisk).toBe(true);
    expect(diff.rowsToUpsert[0].forecastChangedAt).toBe(now);
  });

  it("emits edge card when forecast flips at_risk → on_track", () => {
    const diff = computeAlertDiff({
      workspaces: [ws({ utilizationPct: 60, currentMonthCents: 60_000 })],
      forecasts: new Map([["ws-1", ONTRACK]]),
      priorState: [priorRow({ forecastAtRisk: true })],
      month,
      now,
    });
    expect(diff.forecastEdges).toEqual([{ workspaceId: "ws-1", nextValue: false }]);
  });

  it("emits NO edge card while state is stable", () => {
    const diff = computeAlertDiff({
      workspaces: [ws({ utilizationPct: 60, currentMonthCents: 60_000 })],
      forecasts: new Map([["ws-1", ATRISK]]),
      priorState: [priorRow({ forecastAtRisk: true })],
      month,
      now,
    });
    expect(diff.forecastEdges).toHaveLength(0);
  });
});

describe("computeAlertDiff — default workspace", () => {
  it("uses null workspaceId end-to-end (no string sentinel leak)", () => {
    const diff = computeAlertDiff({
      workspaces: [
        ws({ workspaceId: null, name: "Default Workspace", utilizationPct: 85, currentMonthCents: 85_000 }),
      ],
      forecasts: new Map([["__default__", ONTRACK]]),
      priorState: [],
      month,
      now,
    });
    expect(diff.thresholdsToFire).toEqual([
      { workspaceId: null, threshold: "threshold_80" },
    ]);
    expect(diff.rowsToUpsert[0].workspaceId).toBe(null);
  });
});

describe("computeAlertDiff — month rollover", () => {
  it("re-arms thresholds when the prior row is from last month", () => {
    // Prior state is for April; we're now evaluating May. The May row doesn't
    // exist yet, so even though the workspace is at 85%, the May threshold_80
    // fires. (Caller filters priorState by month — verified below by passing
    // an empty array.)
    const diff = computeAlertDiff({
      workspaces: [ws({ utilizationPct: 85, currentMonthCents: 85_000 })],
      forecasts: new Map([["ws-1", ONTRACK]]),
      priorState: [], // caller filtered out the April row
      month,
      now,
    });
    expect(diff.thresholdsToFire).toEqual([
      { workspaceId: "ws-1", threshold: "threshold_80" },
    ]);
  });
});
