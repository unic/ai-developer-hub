export type ModelPricing = {
  prefix: string;
  inputPerMToken: number;
  outputPerMToken: number;
  cacheReadPerMToken: number;
  cacheWritePerMToken: number;
};

/**
 * Anthropic model pricing table, ordered with highest-priced first for safe
 * fallback. Index 0 (Opus) is used when no prefix matches an unknown model.
 */
export const MODEL_PRICING: ModelPricing[] = [
  // Pricing source: https://docs.anthropic.com/en/docs/about-claude/models
  {
    prefix: "claude-opus-4",
    inputPerMToken: 15,
    outputPerMToken: 75,
    cacheReadPerMToken: 1.5,
    cacheWritePerMToken: 18.75,
  },
  {
    prefix: "claude-sonnet-4",
    inputPerMToken: 3,
    outputPerMToken: 15,
    cacheReadPerMToken: 0.3,
    cacheWritePerMToken: 3.75,
  },
  {
    prefix: "claude-haiku-4",
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
