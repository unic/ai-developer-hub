import { describe, it, expect } from "vitest";
import {
  classifyMonths,
  computeScenarios,
  mapSeat,
  usageForUser,
  type ScenarioInputs,
} from "@/lib/scenarios/api-subscription";
import type { ApiSubscriptionDataset, ApiUser } from "@/lib/scenarios/types";

/**
 * Real per-user spend (cents) for the three complete months Mar/Apr/May 2026,
 * captured from anthropic_usage_metrics on 2026-06-09. These lock the engine to
 * the figures validated in the prototype (specs/035 prototype.html):
 *   baseline $3,041 · all-Standard $1,175 · all-Premium $5,875 · right-sized $2,075.
 * Tuple: [userId, status, mar, apr, may]
 */
const REAL: Array<[number, "active" | "inactive", number, number, number]> = [
  [17, "inactive", 25937, 34602, 25652],
  [12, "inactive", 15086, 21937, 20423],
  [101, "active", 7257, 20230, 25464],
  [6, "active", 8975, 17610, 24578],
  [9, "active", 13754, 17503, 17238],
  [26, "active", 14738, 10091, 20758],
  [36, "active", 13904, 31090, 0],
  [35, "active", 16432, 2282, 25791],
  [16, "active", 12412, 18205, 12352],
  [7, "active", 6816, 13419, 14447],
  [31, "active", 15919, 17757, 0],
  [8, "active", 11072, 5215, 12781],
  [24, "active", 10643, 8329, 9258],
  [78, "inactive", 917, 9679, 16188],
  [18, "active", 7998, 6811, 11566],
  [113, "active", 8675, 8639, 8073],
  [80, "active", 670, 9080, 11848],
  [32, "active", 8086, 8673, 2260],
  [33, "inactive", 97, 7640, 9403],
  [21, "active", 4826, 6693, 4269],
  [13, "active", 2713, 6098, 6316],
  [115, "active", 0, 6601, 7880],
  [19, "active", 670, 5421, 7795],
  [37, "active", 4416, 5693, 3725],
  [20, "active", 8864, 2246, 2373],
  [114, "active", 372, 8484, 3664],
  [75, "active", 0, 0, 10223],
  [62, "active", 373, 5538, 4241],
  [11, "active", 5590, 3430, 635],
  [29, "active", 2675, 544, 5684],
  [96, "active", 754, 3183, 3901],
  [14, "active", 2231, 3029, 1885],
  [73, "active", 0, 0, 4900],
  [92, "active", 0, 644, 3250],
  [34, "active", 80, 2163, 1424],
  [131, "active", 27, 733, 2796],
  [51, "active", 0, 1310, 2144],
  [103, "active", 0, 0, 3036],
  [54, "active", 0, 0, 366],
  [135, "active", 0, 0, 259],
  [22, "active", 0, 0, 0],
  [3, "active", 0, 0, 0],
  [106, "active", 0, 0, 0],
  [82, "active", 0, 0, 0],
  [55, "active", 0, 0, 0],
  [57, "active", 0, 0, 0],
  [2, "active", 0, 0, 1],
];

function realDataset(): ApiSubscriptionDataset {
  const users: ApiUser[] = REAL.map(([id, status, mar, apr, may]) => ({
    userId: id,
    name: `User ${id}`,
    email: `u${id}@example.com`,
    discipline: "developer",
    status,
    workspace: null,
    internalTier: null,
    monthly: { "2026-03": mar, "2026-04": apr, "2026-05": may },
  }));
  return {
    users,
    completeMonths: ["2026-03", "2026-04", "2026-05"],
    partialMonths: [],
    defaultStandardCents: 2500,
    defaultPremiumCents: 12500,
    generatedAt: "2026-06-09T00:00:00.000Z",
  };
}

const baseInputs: ScenarioInputs = {
  standardCents: 2500,
  premiumCents: 12500,
  premiumThresholdCents: 12500,
  apiThresholdCents: 2500, // $25 — keys burning below this (a Standard seat) stay on metered API
  basis: "avgComplete",
  population: "all",
};

describe("usageForUser", () => {
  const ds = realDataset();
  const user: ApiUser = {
    userId: 1,
    name: "x",
    email: "x",
    discipline: null,
    status: "active",
    workspace: null,
    internalTier: null,
    monthly: { "2026-03": 300, "2026-04": 600, "2026-05": 900 },
  };

  it("avgComplete is the mean of complete months, rounded", () => {
    expect(usageForUser(user, ds, "avgComplete")).toBe(600);
  });

  it("rounds the average to the nearest cent", () => {
    const u = {
      ...user,
      monthly: { "2026-03": 100, "2026-04": 100, "2026-05": 101 },
    };
    expect(usageForUser(u, ds, "avgComplete")).toBe(100); // 301/3 = 100.33 -> 100
  });

  it("latestComplete returns the most recent complete month", () => {
    expect(usageForUser(user, ds, "latestComplete")).toBe(900);
  });

  it("peakComplete returns the single highest complete month", () => {
    const u = {
      ...user,
      monthly: { "2026-03": 900, "2026-04": 200, "2026-05": 500 },
    };
    expect(usageForUser(u, ds, "peakComplete")).toBe(900);
  });

  it("a specific month basis reads exactly that month", () => {
    expect(usageForUser(user, ds, { month: "2026-04" })).toBe(600);
    expect(usageForUser(user, ds, { month: "2099-01" })).toBe(0);
  });

  it("returns 0 when there are no complete months", () => {
    const empty = { ...ds, completeMonths: [] };
    expect(usageForUser(user, empty, "avgComplete")).toBe(0);
  });
});

describe("mapSeat", () => {
  it("assigns Premium when usage is at or above the Premium threshold (boundary inclusive)", () => {
    expect(mapSeat(12500, baseInputs)).toEqual({
      tier: "premium",
      seatCents: 12500,
    });
  });

  it("assigns Standard just below the Premium threshold", () => {
    expect(mapSeat(12499, baseInputs)).toEqual({
      tier: "standard",
      seatCents: 2500,
    });
  });

  it("assigns Standard at the API threshold (boundary inclusive of the seat)", () => {
    expect(mapSeat(2500, baseInputs)).toEqual({
      tier: "standard",
      seatCents: 2500,
    });
  });

  it("keeps a key metered below the API threshold (seatCents = its own burn)", () => {
    expect(mapSeat(2499, baseInputs)).toEqual({ tier: "api", seatCents: 2499 });
    expect(mapSeat(0, baseInputs)).toEqual({ tier: "api", seatCents: 0 });
  });

  it("with apiThreshold 0 no key is ever kept metered (legacy two-band behaviour)", () => {
    expect(mapSeat(0, { ...baseInputs, apiThresholdCents: 0 })).toEqual({
      tier: "standard",
      seatCents: 2500,
    });
  });
});

describe("computeScenarios — regression anchors on live data", () => {
  const ds = realDataset();

  it("three-band right-sizing on all 47 keys ($25 API floor, $125 Premium)", () => {
    const r = computeScenarios(ds, baseInputs);
    expect(r.count).toBe(47);
    expect(r.baselineCents).toBe(304140); // $3,041.40/mo run-rate (unchanged)
    expect(r.allStandardCents).toBe(117500); // $1,175 (unchanged — naïve baseline)
    expect(r.allPremiumCents).toBe(587500); // $5,875 (unchanged — naïve baseline)
    // 9 Premium + 22 Standard + 16 metered API ($100.91 of real burn)
    expect(r.rightSizedCents).toBe(177591); // $1,775.91
    expect(r.premiumCount).toBe(9);
    expect(r.standardCount).toBe(22);
    expect(r.apiCount).toBe(16);
  });

  it("apiThreshold 0 reproduces the legacy two-band figures (superset property)", () => {
    const r = computeScenarios(ds, { ...baseInputs, apiThresholdCents: 0 });
    expect(r.rightSizedCents).toBe(207500); // $2,075 (9 Premium + 38 Standard)
    expect(r.premiumCount).toBe(9);
    expect(r.standardCount).toBe(38);
    expect(r.apiCount).toBe(0);
  });

  it("filters to the active population (43 keys), three-band", () => {
    const r = computeScenarios(ds, { ...baseInputs, population: "active" });
    expect(r.count).toBe(43);
    expect(r.baselineCents).toBe(241620); // $2,416.20 (unchanged)
    expect(r.premiumCount).toBe(7);
    expect(r.standardCount).toBe(20);
    expect(r.apiCount).toBe(16);
    // 7×$125 + 20×$25 + $100.91 metered = $1,475.91
    expect(r.rightSizedCents).toBe(147591);
  });

  it("all-Standard / all-Premium scale linearly with editable prices", () => {
    const r = computeScenarios(ds, {
      ...baseInputs,
      standardCents: 3000,
      premiumCents: 10000,
    });
    expect(r.allStandardCents).toBe(47 * 3000);
    expect(r.allPremiumCents).toBe(47 * 10000);
  });

  it("a higher threshold pushes more users onto Standard", () => {
    const low = computeScenarios(ds, {
      ...baseInputs,
      premiumThresholdCents: 5000,
    });
    const high = computeScenarios(ds, {
      ...baseInputs,
      premiumThresholdCents: 30000,
    });
    expect(low.premiumCount).toBeGreaterThan(high.premiumCount);
  });

  it("per-user delta = seat − usage (negative means the seat is cheaper)", () => {
    const r = computeScenarios(ds, baseInputs);
    for (const row of r.rows) {
      expect(row.deltaCents).toBe(row.seatCents - row.usageCents);
    }
  });

  it("metered-API rows carry their own burn as seat cost and net a zero delta", () => {
    const r = computeScenarios(ds, baseInputs);
    const apiRows = r.rows.filter((row) => row.tier === "api");
    expect(apiRows.length).toBe(16);
    for (const row of apiRows) {
      expect(row.seatCents).toBe(row.usageCents);
      expect(row.deltaCents).toBe(0);
    }
    // the seat column still foots to the right-sized total
    const seatSum = r.rows.reduce((s, row) => s + row.seatCents, 0);
    expect(seatSum).toBe(r.rightSizedCents);
  });
});

describe("classifyMonths", () => {
  const months = ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];

  it("marks the current month and a mid-month start as partial", () => {
    const r = classifyMonths(months, "2026-02-27", "2026-06");
    expect(r.completeMonths).toEqual(["2026-03", "2026-04", "2026-05"]);
    expect(r.partialMonths).toEqual(["2026-02", "2026-06"]);
  });

  it("treats the earliest month as complete when data starts on the 1st", () => {
    const r = classifyMonths(months, "2026-02-01", "2026-06");
    expect(r.completeMonths).toEqual([
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
    ]);
    expect(r.partialMonths).toEqual(["2026-06"]);
  });

  it("treats the earliest month as partial when minDate is unknown (null)", () => {
    const r = classifyMonths(["2026-03", "2026-04"], null, "2026-04");
    expect(r.completeMonths).toEqual([]);
    expect(r.partialMonths).toEqual(["2026-03", "2026-04"]);
  });

  it("never double-counts when earliest === current", () => {
    const r = classifyMonths(["2026-06"], "2026-06-15", "2026-06");
    expect(r.completeMonths).toEqual([]);
    expect(r.partialMonths).toEqual(["2026-06"]);
  });
});
