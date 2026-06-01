import { describe, it, expect } from "vitest";
import {
  resolveModelPricing,
  computeCostCents,
} from "@/lib/anthropic-pricing";

describe("resolveModelPricing", () => {
  it("resolves Opus 4.8 to the $5/$25 tier", () => {
    const { pricing, resolved } = resolveModelPricing(
      "claude-opus-4-8-20260101",
    );

    expect(resolved).toBe(true);
    expect(pricing.prefix).toBe("claude-opus-4-8");
    expect(pricing.inputPerMToken).toBe(5);
    expect(pricing.outputPerMToken).toBe(25);
    expect(pricing.cacheReadPerMToken).toBe(0.5);
    expect(pricing.cacheWritePerMToken).toBe(6.25);
  });

  it("keeps Opus 4.5/4.6/4.7 on the $5/$25 tier", () => {
    for (const model of [
      "claude-opus-4-5-20251101",
      "claude-opus-4-6-20251201",
      "claude-opus-4-7-20260101",
    ]) {
      const { pricing, resolved } = resolveModelPricing(model);
      expect(resolved).toBe(true);
      expect(pricing.inputPerMToken).toBe(5);
      expect(pricing.outputPerMToken).toBe(25);
    }
  });

  it("resolves Opus 4.0/4.1 to the $15/$75 tier", () => {
    const { pricing, resolved } = resolveModelPricing(
      "claude-opus-4-1-20250805",
    );
    expect(resolved).toBe(true);
    expect(pricing.inputPerMToken).toBe(15);
    expect(pricing.outputPerMToken).toBe(75);
  });

  it("falls back to the highest (Opus 4.0/4.1) tier for unknown models", () => {
    const { pricing, resolved } = resolveModelPricing("gpt-5.5-turbo");
    expect(resolved).toBe(false);
    expect(pricing.inputPerMToken).toBe(15);
    expect(pricing.outputPerMToken).toBe(75);
  });
});

describe("computeCostCents", () => {
  it("computes cost in cents from token counts and Opus 4.8 pricing", () => {
    const { pricing } = resolveModelPricing("claude-opus-4-8-20260101");

    // 1M uncached input ($5) + 1M output ($25) = $30.00 = 3000 cents
    const cents = computeCostCents(
      {
        uncachedInputTokens: 1_000_000,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        outputTokens: 1_000_000,
      },
      pricing,
    );

    expect(cents).toBe(3000);
  });
});
