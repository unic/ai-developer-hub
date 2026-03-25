import { describe, it, expect } from "vitest";
import { hashSourceType } from "@/lib/sync/framework";

describe("withSyncLock mutual exclusion", () => {
  it("produces stable advisory lock IDs per source", () => {
    const id1 = hashSourceType("invoice_period_matching");
    const id2 = hashSourceType("invoice_period_matching");
    expect(id1).toBe(id2);
  });

  it("produces different lock IDs for different sources", () => {
    const id1 = hashSourceType("invoice_period_matching");
    const id2 = hashSourceType("github_copilot_billing");
    expect(id1).not.toBe(id2);
  });

  // Full mutual exclusion test requires DB connection
  // When DB is available:
  // - Start one sync on invoice_period_matching
  // - Immediately start a second on the same source
  // - Verify the second call throws "Sync already in progress"
  it.todo("rejects concurrent syncs on same source (requires DB)");
});
