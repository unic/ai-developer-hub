import { describe, it, expect, vi } from "vitest";
import { hashSourceType, retryWithBackoff } from "@/lib/sync/framework";

describe("hashSourceType", () => {
  it("returns a bigint", () => {
    const result = hashSourceType("github_copilot_billing");
    expect(typeof result).toBe("bigint");
  });

  it("is deterministic", () => {
    const a = hashSourceType("github_copilot_billing");
    const b = hashSourceType("github_copilot_billing");
    expect(a).toBe(b);
  });

  it("produces distinct values for all 6 source types", () => {
    const sources = [
      "github_copilot_billing",
      "anthropic_api_usage",
      "anthropic_team_invoices",
      "github_members",
      "invoice_period_matching",
      "anthropic_api_costs",
    ];
    const hashes = sources.map(hashSourceType);
    const uniqueHashes = new Set(hashes.map(String));
    expect(uniqueHashes.size).toBe(6);
  });
});

describe("retryWithBackoff", () => {
  it("resolves immediately on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retryWithBackoff(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure up to maxRetries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    await expect(
      retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2 })
    ).rejects.toThrow("fail");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("succeeds after retries", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");
    const result = await retryWithBackoff(fn, {
      maxRetries: 3,
      baseDelayMs: 1,
      maxDelayMs: 2,
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
