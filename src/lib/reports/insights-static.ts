/**
 * Static-rule insight generator for the Overview tab. Pure function: given
 * the current month vs the prior month and an optional budget-forecast
 * summary, returns up to four `Insight` cards in priority order. Each rule
 * returns null when it has nothing useful to say.
 */

export type InsightSeverity = "info" | "warn" | "danger";
export type InsightIcon =
  | "trend-up"
  | "trend-down"
  | "warn"
  | "shield"
  | "spark";

export interface Insight {
  key: string;
  severity: InsightSeverity;
  icon: InsightIcon;
  headline: string;
  body: string;
}

export interface InsightInput {
  current: {
    activeLicenses: number;
    expectedMonthlyCents: number;
    /** Per-tool active assignment count, keyed by tool id. */
    licensesByTool: Map<number, { name: string; count: number }>;
  };
  previous: {
    activeLicenses: number;
    expectedMonthlyCents: number;
    licensesByTool: Map<number, { name: string; count: number }>;
  } | null;
  budget: {
    status: "on_track" | "at_risk";
    projectedAnnualTotalCents: number;
    budgetCeilingCents: number;
  } | null;
  /** Most recent past month variance percent (Actual vs Planned); null when not available. */
  lastMonthVariancePct: number | null;
  lastMonthLabel: string | null;
}

const SIGNIFICANT_LICENSE_DELTA = 5;
const SIGNIFICANT_LICENSE_PCT = 0.2;
const SIGNIFICANT_SPEND_PCT = 0.1;

function dollarsFromCents(cents: number): string {
  const abs = Math.abs(cents) / 100;
  if (abs >= 1000) {
    return `$${(abs / 1000).toFixed(1)}k`;
  }
  return `$${abs.toFixed(0)}`;
}

function topLicenseMover(input: InsightInput, direction: "up" | "down"): Insight | null {
  if (!input.previous) return null;
  const isBetter = (delta: number, best: number) =>
    direction === "up" ? delta > best : delta < best;

  let bestToolId: number | null = null;
  let bestDelta = 0;
  let bestName = "";
  let bestPrior = 0;
  let bestCurrent = 0;

  for (const [toolId, { name, count }] of input.current.licensesByTool) {
    const prior = input.previous.licensesByTool.get(toolId)?.count ?? 0;
    const delta = count - prior;
    if (isBetter(delta, bestDelta)) {
      bestDelta = delta;
      bestToolId = toolId;
      bestName = name;
      bestPrior = prior;
      bestCurrent = count;
    }
  }
  if (direction === "down") {
    for (const [toolId, { name, count }] of input.previous.licensesByTool) {
      if (input.current.licensesByTool.has(toolId)) continue;
      const delta = -count;
      if (isBetter(delta, bestDelta)) {
        bestDelta = delta;
        bestToolId = toolId;
        bestName = name;
        bestPrior = count;
        bestCurrent = 0;
      }
    }
  }
  if (bestToolId === null) return null;
  const absDelta = Math.abs(bestDelta);
  const pctDelta = bestPrior > 0 ? absDelta / bestPrior : 1;
  if (absDelta < SIGNIFICANT_LICENSE_DELTA && pctDelta < SIGNIFICANT_LICENSE_PCT) {
    return null;
  }
  const arrow = direction === "up" ? "▲" : "▼";
  const verb = direction === "up" ? "grew" : "shrunk";
  return {
    key: `licenses-${direction}-${bestToolId}`,
    severity: direction === "up" ? "warn" : "info",
    icon: direction === "up" ? "trend-up" : "trend-down",
    headline: `${bestName} ${verb} ${bestPrior} → ${bestCurrent} seats`,
    body: `${arrow} ${absDelta} seat${absDelta === 1 ? "" : "s"} vs last month${
      bestPrior > 0 ? ` (${(pctDelta * 100).toFixed(0)}% MoM)` : ""
    }.`,
  };
}

function spendInsight(input: InsightInput): Insight | null {
  if (!input.previous) return null;
  const current = input.current.expectedMonthlyCents;
  const prior = input.previous.expectedMonthlyCents;
  if (prior === 0) return null;
  const pct = (current - prior) / prior;
  if (Math.abs(pct) < SIGNIFICANT_SPEND_PCT) return null;
  const direction = pct > 0 ? "up" : "down";
  const arrow = direction === "up" ? "▲" : "▼";
  return {
    key: `spend-${direction}`,
    severity: direction === "up" ? "warn" : "info",
    icon: direction === "up" ? "trend-up" : "trend-down",
    headline: `Expected monthly spend ${arrow} ${(Math.abs(pct) * 100).toFixed(1)}%`,
    body: `${dollarsFromCents(prior)} → ${dollarsFromCents(current)} vs last month.`,
  };
}

function budgetHealthInsight(input: InsightInput): Insight | null {
  if (!input.budget) return null;
  const { status, projectedAnnualTotalCents, budgetCeilingCents } = input.budget;
  if (budgetCeilingCents === 0) return null;
  const overage = projectedAnnualTotalCents - budgetCeilingCents;
  const pct = (projectedAnnualTotalCents / budgetCeilingCents) * 100;
  if (status === "at_risk") {
    return {
      key: "budget-at-risk",
      severity: "danger",
      icon: "warn",
      headline: `Budget at risk — projected ${dollarsFromCents(overage)} over`,
      body: `Linear trend lands at ${dollarsFromCents(
        projectedAnnualTotalCents
      )} (${pct.toFixed(0)}% of ${dollarsFromCents(budgetCeilingCents)} ceiling).`,
    };
  }
  return {
    key: "budget-on-track",
    severity: "info",
    icon: "shield",
    headline: "Budget on track",
    body: `Projected ${dollarsFromCents(
      projectedAnnualTotalCents
    )} (${pct.toFixed(0)}% of ${dollarsFromCents(budgetCeilingCents)}).`,
  };
}

function pastMonthInsight(input: InsightInput): Insight | null {
  if (input.lastMonthVariancePct === null || input.lastMonthLabel === null) {
    return null;
  }
  const pct = input.lastMonthVariancePct;
  if (Math.abs(pct) < 5) return null;
  const direction = pct > 0 ? "over" : "under";
  const arrow = pct > 0 ? "▲" : "▼";
  return {
    key: "past-month-variance",
    severity: pct > 0 ? "warn" : "info",
    icon: pct > 0 ? "trend-up" : "trend-down",
    headline: `${input.lastMonthLabel} was ${Math.abs(pct).toFixed(1)}% ${direction} plan`,
    body: `${arrow} ${Math.abs(pct).toFixed(1)}% vs planned monthly amount.`,
  };
}

/** Return up to four insights in priority order. Rules that return null are dropped. */
export function getStaticInsights(input: InsightInput): Insight[] {
  const candidates = [
    budgetHealthInsight(input),
    topLicenseMover(input, "up"),
    spendInsight(input),
    pastMonthInsight(input),
    topLicenseMover(input, "down"),
  ];
  return candidates.filter((i): i is Insight => i !== null).slice(0, 4);
}
