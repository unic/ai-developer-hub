import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isRateLimited, resetLimit } from "@/lib/rate-limit";

const CONFIG = { maxAttempts: 3, windowMs: 60_000 };

describe("isRateLimited", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Clean up all keys used in tests
    resetLimit("test-key");
    resetLimit("key-a");
    resetLimit("key-b");
    vi.useRealTimers();
  });

  it("first call is not rate limited", () => {
    expect(isRateLimited("test-key", CONFIG)).toBe(false);
  });

  it("calls up to maxAttempts are allowed", () => {
    for (let i = 0; i < CONFIG.maxAttempts; i++) {
      expect(isRateLimited("test-key", CONFIG)).toBe(false);
    }
  });

  it("call exceeding maxAttempts is rate limited", () => {
    for (let i = 0; i < CONFIG.maxAttempts; i++) {
      isRateLimited("test-key", CONFIG);
    }
    expect(isRateLimited("test-key", CONFIG)).toBe(true);
  });

  it("window reset allows new attempts after time passes", () => {
    // Exhaust the limit
    for (let i = 0; i < CONFIG.maxAttempts; i++) {
      isRateLimited("test-key", CONFIG);
    }
    expect(isRateLimited("test-key", CONFIG)).toBe(true);

    // Advance past the window
    vi.advanceTimersByTime(CONFIG.windowMs);

    // Should be allowed again
    expect(isRateLimited("test-key", CONFIG)).toBe(false);
  });

  it("resetLimit clears the limit for that key", () => {
    // Exhaust the limit
    for (let i = 0; i < CONFIG.maxAttempts; i++) {
      isRateLimited("test-key", CONFIG);
    }
    expect(isRateLimited("test-key", CONFIG)).toBe(true);

    resetLimit("test-key");

    // Should be allowed again
    expect(isRateLimited("test-key", CONFIG)).toBe(false);
  });

  it("different keys are tracked independently", () => {
    // Exhaust key-a
    for (let i = 0; i < CONFIG.maxAttempts; i++) {
      isRateLimited("key-a", CONFIG);
    }
    expect(isRateLimited("key-a", CONFIG)).toBe(true);

    // key-b should still be allowed
    expect(isRateLimited("key-b", CONFIG)).toBe(false);
  });
});
