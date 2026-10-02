import { describe, it, expect } from "vitest";

import {
  detectDivergence,
  unknownModelMessage,
  TOLERANCE_FLOOR_CENTS,
} from "@/lib/anthropic/reconciliation";

const base = {
  workspaceId: "wrkspc_1",
  workspaceName: "Indie - Someone",
  period: "2026-08",
  hasOwner: true,
};

describe("detectDivergence", () => {
  it("stays quiet when the figures agree", () => {
    expect(
      detectDivergence({ ...base, billedCents: 100_000, attributedCents: 100_000 }),
    ).toBeNull();
  });

  it("stays quiet inside the relative tolerance", () => {
    // 5% of $1,000 is $50.
    expect(
      detectDivergence({ ...base, billedCents: 100_000, attributedCents: 104_999 }),
    ).toBeNull();
  });

  it("stays quiet at exactly the tolerance", () => {
    expect(
      detectDivergence({ ...base, billedCents: 100_000, attributedCents: 105_000 }),
    ).toBeNull();
  });

  it("reports one cent beyond the tolerance", () => {
    const d = detectDivergence({
      ...base,
      billedCents: 100_000,
      attributedCents: 105_001,
    });

    expect(d).not.toBeNull();
    expect(d!.reason).toBe("over_tolerance");
    expect(d!.differenceCents).toBe(5_001);
    expect(d!.toleranceCents).toBe(5_000);
  });

  it("uses the absolute floor for small workspaces", () => {
    // 5% of $10 is 50 cents, which would shout about rounding noise. The $5
    // floor keeps a small workspace quiet.
    expect(
      detectDivergence({ ...base, billedCents: 1_000, attributedCents: 1_400 }),
    ).toBeNull();

    const d = detectDivergence({
      ...base,
      billedCents: 1_000,
      attributedCents: 1_600,
    });
    expect(d!.toleranceCents).toBe(TOLERANCE_FLOOR_CENTS);
  });

  it("catches the original defect's shape", () => {
    // Oliver, September 2026: $32.83 billed against $249.32 computed — 7.59x.
    const d = detectDivergence({
      ...base,
      billedCents: 3_283,
      attributedCents: 24_932,
    });

    expect(d).not.toBeNull();
    expect(d!.ratio).toBeCloseTo(7.59, 1);
    expect(d!.message).toContain("7.59x");
    expect(d!.message).toContain("price table");
  });

  it("reports computed spend against zero billed, with no ratio", () => {
    const d = detectDivergence({
      ...base,
      billedCents: 0,
      attributedCents: 10_000,
    });

    expect(d).not.toBeNull();
    expect(d!.ratio).toBeNull();
    expect(d!.message).not.toContain("NaN");
    expect(d!.message).not.toContain("Infinity");
  });

  it("reports spend in a workspace with no owner", () => {
    const d = detectDivergence({
      ...base,
      hasOwner: false,
      billedCents: 12_662,
      attributedCents: 0,
    });

    expect(d!.reason).toBe("spend_without_owner");
    expect(d!.message).toContain("no resolved owner");
    expect(d!.message).toContain("$126.62");
  });

  it("says nothing about an unowned workspace with no spend", () => {
    expect(
      detectDivergence({
        ...base,
        hasOwner: false,
        billedCents: 0,
        attributedCents: 0,
      }),
    ).toBeNull();
  });

  it("names the default workspace when there is no id", () => {
    const d = detectDivergence({
      ...base,
      workspaceId: null,
      workspaceName: null,
      billedCents: 100,
      attributedCents: 100_000,
    });

    expect(d!.message).toContain("the default workspace");
  });
});

describe("unknownModelMessage", () => {
  it("names the models and says what it costs the reader", () => {
    const msg = unknownModelMessage(["claude-opus-5", "claude-fable-5-1"]);

    expect(msg).toContain("claude-opus-5");
    expect(msg).toContain("claude-fable-5-1");
    expect(msg).toContain("overstates");
  });

  it("truncates a long list rather than filling the event", () => {
    const msg = unknownModelMessage(
      Array.from({ length: 25 }, (_, i) => `model-${i}`),
    );

    expect(msg).toContain("and 15 more");
    expect(msg).toContain("25 model(s)");
  });
});
