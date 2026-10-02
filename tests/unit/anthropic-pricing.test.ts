import { describe, it, expect } from "vitest";
import {
  resolveModelPricing,
  computeCostCents,
  FALLBACK_PRICING,
  MODEL_PRICING,
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

  it("resolves the Claude 5 family to its own tiers", () => {
    const cases = [
      { model: "claude-sonnet-5", input: 2, output: 10, read: 0.2, write: 2.5 },
      { model: "claude-opus-5", input: 5, output: 25, read: 0.5, write: 6.25 },
      { model: "claude-fable-5", input: 10, output: 50, read: 1, write: 12.5 },
    ];

    for (const c of cases) {
      const { pricing, resolved } = resolveModelPricing(c.model);
      expect(resolved).toBe(true);
      expect(pricing.inputPerMToken).toBe(c.input);
      expect(pricing.outputPerMToken).toBe(c.output);
      expect(pricing.cacheReadPerMToken).toBe(c.read);
      expect(pricing.cacheWritePerMToken).toBe(c.write);
    }
  });

  it("prefers the longer prefix so Fable 5.1 is not matched as Fable 5", () => {
    const { pricing, resolved } = resolveModelPricing("claude-fable-5-1");
    expect(resolved).toBe(true);
    expect(pricing.prefix).toBe("claude-fable-5-1");
    // Fable 5.1 cache reads are $0.25/MTok, Fable 5's are $1.00/MTok.
    expect(pricing.cacheReadPerMToken).toBe(0.25);
  });

  it("keeps Sonnet 4.6 on the $3/$15 Sonnet 4 tier", () => {
    const { pricing, resolved } = resolveModelPricing("claude-sonnet-4-6");
    expect(resolved).toBe(true);
    expect(pricing.inputPerMToken).toBe(3);
    expect(pricing.outputPerMToken).toBe(15);
  });

  it("falls back to the highest (Opus 4.0/4.1) tier for unknown models", () => {
    const { pricing, resolved } = resolveModelPricing("gpt-5.5-turbo");
    expect(resolved).toBe(false);
    expect(pricing.inputPerMToken).toBe(15);
    expect(pricing.outputPerMToken).toBe(75);
  });

  it("does not use the first table entry as the fallback tier", () => {
    // Regression guard: the fallback used to be MODEL_PRICING[0], so prepending
    // a cheaper model to the table would silently change unknown-model pricing.
    expect(FALLBACK_PRICING.inputPerMToken).toBe(15);
    expect(FALLBACK_PRICING.outputPerMToken).toBe(75);
    expect(MODEL_PRICING[0].prefix).not.toBe(FALLBACK_PRICING.prefix);
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
