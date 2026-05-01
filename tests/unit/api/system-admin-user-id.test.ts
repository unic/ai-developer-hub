import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockFindFirst } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      users: { findFirst: mockFindFirst },
    },
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: { id: "id", role: "role", status: "status" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ col: _col, val: _val })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getSystemAdminUserId", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    mockFindFirst.mockReset();
  });

  it("throws when SYSTEM_ADMIN_USER_ID is not set", async () => {
    const { getSystemAdminUserId } = await import("@/lib/auth-helpers");
    await expect(getSystemAdminUserId()).rejects.toThrow("not set or empty");
  });

  it("throws when SYSTEM_ADMIN_USER_ID is an empty string", async () => {
    vi.stubEnv("SYSTEM_ADMIN_USER_ID", "");
    const { getSystemAdminUserId } = await import("@/lib/auth-helpers");
    await expect(getSystemAdminUserId()).rejects.toThrow("not set or empty");
  });

  it("throws when SYSTEM_ADMIN_USER_ID is whitespace-only", async () => {
    vi.stubEnv("SYSTEM_ADMIN_USER_ID", "   ");
    const { getSystemAdminUserId } = await import("@/lib/auth-helpers");
    await expect(getSystemAdminUserId()).rejects.toThrow("not set or empty");
  });

  it("throws when SYSTEM_ADMIN_USER_ID is non-numeric", async () => {
    vi.stubEnv("SYSTEM_ADMIN_USER_ID", "abc");
    const { getSystemAdminUserId } = await import("@/lib/auth-helpers");
    await expect(getSystemAdminUserId()).rejects.toThrow(
      'SYSTEM_ADMIN_USER_ID="abc" is not a valid positive integer'
    );
  });

  it("throws when SYSTEM_ADMIN_USER_ID is zero", async () => {
    vi.stubEnv("SYSTEM_ADMIN_USER_ID", "0");
    const { getSystemAdminUserId } = await import("@/lib/auth-helpers");
    await expect(getSystemAdminUserId()).rejects.toThrow(
      "not a valid positive integer"
    );
  });

  it("throws when SYSTEM_ADMIN_USER_ID is negative", async () => {
    vi.stubEnv("SYSTEM_ADMIN_USER_ID", "-5");
    const { getSystemAdminUserId } = await import("@/lib/auth-helpers");
    await expect(getSystemAdminUserId()).rejects.toThrow(
      "not a valid positive integer"
    );
  });

  it("throws when no active admin user with that id exists in the DB", async () => {
    vi.stubEnv("SYSTEM_ADMIN_USER_ID", "999");
    mockFindFirst.mockResolvedValue(undefined);
    const { getSystemAdminUserId } = await import("@/lib/auth-helpers");
    await expect(getSystemAdminUserId()).rejects.toThrow(
      "SYSTEM_ADMIN_USER_ID=999: no active admin user with this id exists"
    );
  });

  it("returns the user id on success", async () => {
    vi.stubEnv("SYSTEM_ADMIN_USER_ID", "7");
    mockFindFirst.mockResolvedValue({ id: 7 });
    const { getSystemAdminUserId } = await import("@/lib/auth-helpers");
    await expect(getSystemAdminUserId()).resolves.toBe(7);
  });

  it("caches the result and probes the DB only once", async () => {
    vi.stubEnv("SYSTEM_ADMIN_USER_ID", "7");
    mockFindFirst.mockResolvedValue({ id: 7 });
    const { getSystemAdminUserId } = await import("@/lib/auth-helpers");
    await getSystemAdminUserId();
    await getSystemAdminUserId();
    expect(mockFindFirst).toHaveBeenCalledTimes(1);
  });

  it("does not cache on failure — retries DB probe on next call", async () => {
    vi.stubEnv("SYSTEM_ADMIN_USER_ID", "7");
    // First call: user not found → throws
    mockFindFirst.mockResolvedValueOnce(undefined);
    // Second call: user found → succeeds
    mockFindFirst.mockResolvedValueOnce({ id: 7 });

    const { getSystemAdminUserId } = await import("@/lib/auth-helpers");
    await expect(getSystemAdminUserId()).rejects.toThrow("no active admin user");
    await expect(getSystemAdminUserId()).resolves.toBe(7);
    expect(mockFindFirst).toHaveBeenCalledTimes(2);
  });
});
