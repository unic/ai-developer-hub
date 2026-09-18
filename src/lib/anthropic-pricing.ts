export type ModelPricing = {
  prefix: string;
  inputPerMToken: number;
  outputPerMToken: number;
  cacheReadPerMToken: number;
  cacheWritePerMToken: number;
};

/**
 * Anthropic model pricing table. Entries may be listed in any order —
 * `resolveModelPricing` always matches the longest (most specific) prefix,
 * so `claude-fable-5-1` cannot be swallowed by `claude-fable-5`.
 *
 * Unknown models fall back to `FALLBACK_PRICING` (the highest-priced tier) and
 * are flagged with `pricingResolved = false` so they can be re-priced once the
 * model is added here. Keep this table current: every model missing from it is
 * silently over-billed at the fallback rate until it is added.
 *
 * Pricing source: https://docs.anthropic.com/en/docs/about-claude/pricing
 */
export const MODEL_PRICING: ModelPricing[] = [
  // Fable 5.1 — $10/$50. Cache reads are $0.25/MTok (not the usual 0.1x input).
  {
    prefix: "claude-fable-5-1",
    inputPerMToken: 10,
    outputPerMToken: 50,
    cacheReadPerMToken: 0.25,
    cacheWritePerMToken: 12.5,
  },
  // Fable 5 — $10/$50
  {
    prefix: "claude-fable-5",
    inputPerMToken: 10,
    outputPerMToken: 50,
    cacheReadPerMToken: 1,
    cacheWritePerMToken: 12.5,
  },
  // Opus 5 — $5/$25
  {
    prefix: "claude-opus-5",
    inputPerMToken: 5,
    outputPerMToken: 25,
    cacheReadPerMToken: 0.5,
    cacheWritePerMToken: 6.25,
  },
  // Sonnet 5 — $2/$10
  {
    prefix: "claude-sonnet-5",
    inputPerMToken: 2,
    outputPerMToken: 10,
    cacheReadPerMToken: 0.2,
    cacheWritePerMToken: 2.5,
  },
  // Opus 4.0 / 4.1 — $15/$75 (highest pricing, used as fallback)
  {
    prefix: "claude-opus-4-0",
    inputPerMToken: 15,
    outputPerMToken: 75,
    cacheReadPerMToken: 1.5,
    cacheWritePerMToken: 18.75,
  },
  {
    prefix: "claude-opus-4-1",
    inputPerMToken: 15,
    outputPerMToken: 75,
    cacheReadPerMToken: 1.5,
    cacheWritePerMToken: 18.75,
  },
  // Opus 4.5 / 4.6 / 4.7 / 4.8 — $5/$25
  {
    prefix: "claude-opus-4-5",
    inputPerMToken: 5,
    outputPerMToken: 25,
    cacheReadPerMToken: 0.5,
    cacheWritePerMToken: 6.25,
  },
  {
    prefix: "claude-opus-4-6",
    inputPerMToken: 5,
    outputPerMToken: 25,
    cacheReadPerMToken: 0.5,
    cacheWritePerMToken: 6.25,
  },
  {
    prefix: "claude-opus-4-7",
    inputPerMToken: 5,
    outputPerMToken: 25,
    cacheReadPerMToken: 0.5,
    cacheWritePerMToken: 6.25,
  },
  {
    prefix: "claude-opus-4-8",
    inputPerMToken: 5,
    outputPerMToken: 25,
    cacheReadPerMToken: 0.5,
    cacheWritePerMToken: 6.25,
  },
  // Sonnet 4.x — all $3/$15
  {
    prefix: "claude-sonnet-4",
    inputPerMToken: 3,
    outputPerMToken: 15,
    cacheReadPerMToken: 0.3,
    cacheWritePerMToken: 3.75,
  },
  // Haiku 4.5 — $1/$5
  {
    prefix: "claude-haiku-4-5",
    inputPerMToken: 1,
    outputPerMToken: 5,
    cacheReadPerMToken: 0.1,
    cacheWritePerMToken: 1.25,
  },
  // Haiku 3.5 — $0.80/$4
  {
    prefix: "claude-haiku-3-5",
    inputPerMToken: 0.8,
    outputPerMToken: 4,
    cacheReadPerMToken: 0.08,
    cacheWritePerMToken: 1,
  },
];

/**
 * Pricing applied to models that are not in `MODEL_PRICING` — the highest tier
 * ever charged ($15/$75, Opus 4.0/4.1), so an unknown model is never silently
 * under-billed. Rows priced this way carry `pricingResolved = false`.
 */
export const FALLBACK_PRICING: ModelPricing =
  MODEL_PRICING.find((p) => p.prefix === "claude-opus-4-0") ?? MODEL_PRICING[0];

/**
 * Resolve pricing for a model string using prefix matching.
 * The longest matching prefix wins, so table order does not matter.
 * Falls back to `FALLBACK_PRICING` with resolved=false if no prefix matches.
 */
export function resolveModelPricing(model: string): {
  pricing: ModelPricing;
  resolved: boolean;
} {
  let match: ModelPricing | null = null;
  for (const entry of MODEL_PRICING) {
    if (!model.startsWith(entry.prefix)) continue;
    if (!match || entry.prefix.length > match.prefix.length) {
      match = entry;
    }
  }
  if (match) return { pricing: match, resolved: true };
  return { pricing: FALLBACK_PRICING, resolved: false };
}

/**
 * Compute cost in cents from token counts and pricing per million tokens.
 */
export function computeCostCents(
  tokens: {
    uncachedInputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    outputTokens: number;
  },
  pricing: ModelPricing,
): number {
  const dollarCost =
    (tokens.uncachedInputTokens * pricing.inputPerMToken) / 1_000_000 +
    (tokens.cacheReadInputTokens * pricing.cacheReadPerMToken) / 1_000_000 +
    (tokens.cacheCreationInputTokens * pricing.cacheWritePerMToken) /
      1_000_000 +
    (tokens.outputTokens * pricing.outputPerMToken) / 1_000_000;

  return Math.round(dollarCost * 100);
}
