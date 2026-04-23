export type ModelPricing = {
  prefix: string;
  inputPerMToken: number;
  outputPerMToken: number;
  cacheReadPerMToken: number;
  cacheWritePerMToken: number;
};

/**
 * Anthropic model pricing table, ordered by prefix length (longest first)
 * so that the most specific prefix matches first.
 * Index 0 (Opus 4.0/4.1 — highest priced) is used as fallback for unknown models.
 *
 * Pricing source: https://docs.anthropic.com/en/docs/about-claude/pricing
 */
export const MODEL_PRICING: ModelPricing[] = [
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
  // Opus 4.5 / 4.6 / 4.7 — $5/$25
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
 * Resolve pricing for a model string using prefix matching.
 * Returns the first entry whose prefix matches the start of the model string.
 * Falls back to the highest pricing (index 0) with resolved=false if no match.
 */
export function resolveModelPricing(model: string): {
  pricing: ModelPricing;
  resolved: boolean;
} {
  for (const entry of MODEL_PRICING) {
    if (model.startsWith(entry.prefix)) {
      return { pricing: entry, resolved: true };
    }
  }
  return { pricing: MODEL_PRICING[0], resolved: false };
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
