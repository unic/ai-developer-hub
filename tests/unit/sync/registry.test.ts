import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    execute: vi.fn(),
  },
}));

import { getSyncSources, getSyncSource } from "@/lib/sync/registry";
import { db } from "@/lib/db";

describe("getSyncSources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns shaped results with lastEvent null when no events", async () => {
    // Mock sources query
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockResolvedValue([
        {
          id: 1,
          sourceType: "github_copilot_billing",
          enabled: true,
          cronSchedule: "0 6 * * *",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    } as any);

    // Mock events query (empty)
    vi.mocked(db.execute).mockResolvedValue({ rows: [] } as any);

    const result = await getSyncSources();
    expect(result).toHaveLength(1);
    expect(result[0].sourceType).toBe("github_copilot_billing");
    expect(result[0].lastEvent).toBeNull();
  });
});

describe("getSyncSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for unknown type", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as any);

    const result = await getSyncSource("github_copilot_billing");
    expect(result).toBeNull();
  });
});
