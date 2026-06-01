import { describe, expect, it } from "vitest";
import {
  CALIBRATION_MAX,
  CALIBRATION_MIN,
  estimateTodayCostCents,
} from "@/lib/anthropic/estimate-today";

describe("estimateTodayCostCents", () => {
  it("applies the calibration ratio of workspace/per-user to today's per-user spend", () => {
    // Workspace billed 1.2× our per-user estimate over recent complete days.
    const r = estimateTodayCostCents({
      todayUserCostCents: 1_000,
      recentUserCostCents: 10_000,
      recentWorkspaceCostCents: 12_000,
    });
    expect(r.confident).toBe(true);
    expect(r.calibration).toBeCloseTo(1.2, 5);
    expect(r.estimatedTodayCents).toBe(1_200); // round(1000 * 1.2)
  });

  it("clamps a high ratio to CALIBRATION_MAX so a noisy week can't blow up the figure", () => {
    const r = estimateTodayCostCents({
      todayUserCostCents: 1_000,
      recentUserCostCents: 1_000,
      recentWorkspaceCostCents: 9_000, // raw ratio 9.0 → clamp to 2.0
    });
    expect(r.calibration).toBe(CALIBRATION_MAX);
    expect(r.estimatedTodayCents).toBe(2_000);
  });

  it("clamps a low ratio to CALIBRATION_MIN", () => {
    const r = estimateTodayCostCents({
      todayUserCostCents: 1_000,
      recentUserCostCents: 10_000,
      recentWorkspaceCostCents: 1_000, // raw ratio 0.1 → clamp to 0.5
    });
    expect(r.calibration).toBe(CALIBRATION_MIN);
    expect(r.estimatedTodayCents).toBe(500);
  });

  it("falls back to ×1 (not confident) when there is no recent per-user data", () => {
    const r = estimateTodayCostCents({
      todayUserCostCents: 1_500,
      recentUserCostCents: 0,
      recentWorkspaceCostCents: 5_000,
    });
    expect(r.confident).toBe(false);
    expect(r.calibration).toBe(1);
    expect(r.estimatedTodayCents).toBe(1_500); // uncalibrated per-user sum
  });

  it("falls back to ×1 (not confident) when there is no recent workspace data", () => {
    const r = estimateTodayCostCents({
      todayUserCostCents: 1_500,
      recentUserCostCents: 8_000,
      recentWorkspaceCostCents: 0,
    });
    expect(r.confident).toBe(false);
    expect(r.calibration).toBe(1);
    expect(r.estimatedTodayCents).toBe(1_500);
  });

  it("returns 0 when there is no per-user spend today (query layer maps this to null)", () => {
    const r = estimateTodayCostCents({
      todayUserCostCents: 0,
      recentUserCostCents: 10_000,
      recentWorkspaceCostCents: 12_000,
    });
    expect(r.estimatedTodayCents).toBe(0);
  });

  it("rounds the calibrated estimate to whole cents", () => {
    const r = estimateTodayCostCents({
      todayUserCostCents: 333,
      recentUserCostCents: 1_000,
      recentWorkspaceCostCents: 1_500, // ratio 1.5
    });
    expect(r.estimatedTodayCents).toBe(500); // round(333 * 1.5 = 499.5)
  });

  it("keeps the in-band ratio exactly (no clamping at the boundary)", () => {
    const r = estimateTodayCostCents({
      todayUserCostCents: 2_000,
      recentUserCostCents: 10_000,
      recentWorkspaceCostCents: 5_000, // ratio 0.5 == CALIBRATION_MIN
    });
    expect(r.calibration).toBe(0.5);
    expect(r.estimatedTodayCents).toBe(1_000);
  });
});
