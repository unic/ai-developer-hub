import { describe, it, expect } from "vitest";

import { appendSyncWarning } from "@/lib/sync/warnings";
import type { SyncCounts } from "@/lib/sync/framework";

function counts(over: Partial<SyncCounts> = {}): SyncCounts {
  return {
    createdCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    ...over,
  };
}

describe("appendSyncWarning", () => {
  it("records the message without counting an error", () => {
    const c = counts();
    appendSyncWarning(c, "3 workspace(s) with spend have no resolved owner");

    // The whole point: an error count above zero marks the run partial and
    // stops the cost sync refreshing the dashboard's "last synced" indicator.
    expect(c.errorCount).toBe(0);
    expect(c.errorMessage).toBe(
      "Warning: 3 workspace(s) with spend have no resolved owner",
    );
  });

  it("appends after an existing error without hiding it", () => {
    const c = counts({ errorCount: 1, errorMessage: "Cost sync failed: 500" });
    appendSyncWarning(c, "Oliver: computed 7.35x billed");

    expect(c.errorCount).toBe(1);
    expect(c.errorMessage).toBe(
      "Cost sync failed: 500; Warning: Oliver: computed 7.35x billed",
    );
  });

  it("joins several warnings in order", () => {
    const c = counts();
    appendSyncWarning(c, "first");
    appendSyncWarning(c, "second");

    expect(c.errorCount).toBe(0);
    expect(c.errorMessage).toBe("Warning: first; Warning: second");
  });
});
