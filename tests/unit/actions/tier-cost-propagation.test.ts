import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock transitive dependencies that require server-only modules
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/actions/history", () => ({
  recordCreation: vi.fn(),
  recordUpdate: vi.fn(),
  recordStatusChange: vi.fn(),
}));
vi.mock("@/lib/copilot-api", () => ({
  fetchCopilotBilling: vi.fn(),
  fetchCopilotSeats: vi.fn(),
  fetchCopilotOrgDayReport: vi.fn(),
  fetchCopilotUsersDayReport: vi.fn(),
  downloadReportNdjson: vi.fn(),
}));

const mockTx = {
  update: vi.fn(),
};

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      accessTiers: { findFirst: vi.fn() },
      aiTools: { findFirst: vi.fn() },
    },
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<void>) =>
      cb(mockTx),
    ),
    update: vi.fn(),
    insert: vi.fn(),
    select: vi.fn(),
  },
}));

import { updateTier } from "@/actions/tools";
import { syncBillingData } from "@/lib/copilot-sync";
import { requireAdmin } from "@/lib/auth-helpers";
import { fetchCopilotBilling } from "@/lib/copilot-api";
import { db } from "@/lib/db";
import { accessTiers, licenseAssignments } from "@/lib/db/schema";

function chainedUpdate() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  return { update: { set }, set, where };
}

const existingTier = {
  id: 5,
  toolId: 2,
  name: "Business",
  description: null,
  monthlyCostCents: 0,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("updateTier cost propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({
      id: "1",
      role: "admin",
    } as never);
    vi.mocked(db.query.accessTiers.findFirst).mockResolvedValue(
      existingTier as never,
    );
  });

  it("updates active assignments' cost snapshot when the price changes", async () => {
    const tierUpdate = chainedUpdate();
    const assignmentUpdate = chainedUpdate();
    mockTx.update
      .mockReturnValueOnce(tierUpdate.update)
      .mockReturnValueOnce(assignmentUpdate.update);

    const result = await updateTier({ id: 5, monthlyCostCents: 1900 });

    expect(result.success).toBe(true);
    expect(mockTx.update).toHaveBeenCalledTimes(2);
    expect(mockTx.update).toHaveBeenNthCalledWith(1, accessTiers);
    expect(mockTx.update).toHaveBeenNthCalledWith(2, licenseAssignments);
    expect(assignmentUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({ costAtAssignmentCents: 1900 }),
    );
  });

  it("does not touch assignments when only the name changes", async () => {
    const tierUpdate = chainedUpdate();
    mockTx.update.mockReturnValueOnce(tierUpdate.update);
    // Name-uniqueness check: second findFirst call returns no duplicate
    vi.mocked(db.query.accessTiers.findFirst)
      .mockResolvedValueOnce(existingTier as never)
      .mockResolvedValueOnce(undefined as never);

    const result = await updateTier({ id: 5, name: "Business Plus" });

    expect(result.success).toBe(true);
    expect(mockTx.update).toHaveBeenCalledTimes(1);
    expect(mockTx.update).toHaveBeenCalledWith(accessTiers);
  });

  it("is a no-op when the price is unchanged", async () => {
    const result = await updateTier({ id: 5, monthlyCostCents: 0 });

    expect(result.success).toBe(true);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(mockTx.update).not.toHaveBeenCalled();
  });
});

describe("syncBillingData tier price drift propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchCopilotBilling).mockResolvedValue({
      data: {
        seat_breakdown: { total: 3, active_this_cycle: 2 },
        plan_type: "business",
      },
    } as never);
    vi.mocked(db.query.aiTools.findFirst).mockResolvedValue({
      id: 2,
      name: "GitHub Copilot",
    } as never);
    // db.update for maxLicenses
    vi.mocked(db.update).mockReturnValue(chainedUpdate().update as never);
    // billing snapshot upsert chain
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({ onConflictDoUpdate }),
    } as never);
  });

  it("resyncs active assignments when a tier's synced price differs", async () => {
    // Business tier exists with stale price; Enterprise tier already correct
    vi.mocked(db.query.accessTiers.findFirst)
      .mockResolvedValueOnce({
        id: 5,
        toolId: 2,
        name: "Business",
        monthlyCostCents: 0,
      } as never)
      .mockResolvedValueOnce({
        id: 6,
        toolId: 2,
        name: "Enterprise",
        monthlyCostCents: 3900,
      } as never);

    const tierUpdate = chainedUpdate();
    const assignmentUpdate = chainedUpdate();
    mockTx.update
      .mockReturnValueOnce(tierUpdate.update)
      .mockReturnValueOnce(assignmentUpdate.update);

    await syncBillingData({ id: 1, orgLogin: "acme" }, "token");

    // One transaction for the drifted Business tier, none for Enterprise
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.update).toHaveBeenNthCalledWith(1, accessTiers);
    expect(mockTx.update).toHaveBeenNthCalledWith(2, licenseAssignments);
    expect(tierUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({ monthlyCostCents: 1900 }),
    );
    expect(assignmentUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({ costAtAssignmentCents: 1900 }),
    );
  });
});
