/**
 * The words for a tier price.
 *
 * Spec 045: for a `seat` tier the price is a monthly COST — you pay it whether
 * or not the seat is used. For a `usage` tier it is a monthly ALLOWANCE: how
 * much that person may spend, which the Hub does not enforce and which nobody
 * has ever spent in full. Showing both as "monthly cost" is what let $3,650 of
 * allowance masquerade as $3,650 of expected spend.
 *
 * Seat wording is unchanged from before this feature (P1/L3) — no relabelling
 * ripples into tools that were never affected.
 */

import type { PricingModel } from "@/lib/expected-spend";

export interface PriceWording {
  /** Form / column label: "Monthly Cost ($)" or "Monthly Allowance ($)". */
  label: string;
  /** Inline suffix after a formatted amount: "/mo" or "/mo allowance". */
  suffix: string;
  /** Short noun for prose: "cost" or "allowance". */
  noun: string;
  /** Tooltip explaining what the number is, for usage tiers only. */
  title?: string;
}

const SEAT: PriceWording = {
  label: "Monthly Cost",
  suffix: "/mo",
  noun: "cost",
};

const USAGE: PriceWording = {
  label: "Monthly Allowance",
  suffix: "/mo allowance",
  noun: "allowance",
  title:
    "This is a spend allowance, not a cost: how much this person may spend on metered API usage in a month. The Hub does not enforce it — the cap is set in the vendor console — and expected spend is based on what was actually consumed, not on this number.",
};

export function priceWording(
  pricingModel: PricingModel | null | undefined,
): PriceWording {
  return pricingModel === "usage" ? USAGE : SEAT;
}

/** True when this price is an allowance rather than a cost. */
export function isAllowance(
  pricingModel: PricingModel | null | undefined,
): boolean {
  return pricingModel === "usage";
}
