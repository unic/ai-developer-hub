import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Chainable db mock ────────────────────────────────────────────────────────
// insert/update/delete/select chains are awaitable at any point; .returning()
// and terminal awaits consume per-operation queues. db.query.*.findFirst are
// plain mocks.

const {
  updateReturningQueue,
  selectQueue,
  mockTokensFindFirst,
  mockClientsFindFirst,
  mockUsersFindFirst,
  insertedRows,
  updateCalls,
} = vi.hoisted(() => ({
  updateReturningQueue: [] as unknown[],
  selectQueue: [] as unknown[],
  mockTokensFindFirst: vi.fn(),
  mockClientsFindFirst: vi.fn(),
  mockUsersFindFirst: vi.fn(),
  insertedRows: [] as Array<{ table: unknown; values: unknown }>,
  updateCalls: [] as Array<{ set: unknown }>,
}));

vi.mock("@/lib/db", () => {
  const awaitable = (rows: unknown) => ({
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  });
  return {
    db: {
      insert: (table: unknown) => ({
        values: (values: unknown) => {
          insertedRows.push({ table, values });
          return {
            ...awaitable(undefined),
            returning: () => Promise.resolve([values]),
          };
        },
      }),
      update: () => ({
        set: (set: unknown) => {
          updateCalls.push({ set });
          return {
            where: () => ({
              ...awaitable(undefined),
              returning: () =>
                Promise.resolve(updateReturningQueue.shift() ?? []),
            }),
          };
        },
      }),
      delete: () => ({ where: () => awaitable(undefined) }),
      select: () => {
        const chain: Record<string, unknown> = {};
        for (const method of ["from", "innerJoin", "where", "limit", "orderBy"]) {
          chain[method] = () => chain;
        }
        chain.then = (
          resolve: (v: unknown) => unknown,
          reject?: (e: unknown) => unknown,
        ) => Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject);
        return chain;
      },
      query: {
        mcpOauthTokens: { findFirst: mockTokensFindFirst },
        mcpOauthClients: { findFirst: mockClientsFindFirst },
        users: { findFirst: mockUsersFindFirst },
      },
    },
  };
});

import {
  issueTokens,
  rotateRefreshToken,
  sha256Hex,
  verifyAccessToken,
} from "@/lib/oauth/store";

const FUTURE = new Date(Date.now() + 86_400_000);
const PAST = new Date(Date.now() - 86_400_000);

/** Row shape returned by rotateRefreshToken's token+user joined select. */
function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    familyId: "fam-1",
    clientId: 1,
    userId: 42,
    scope: "mcp:read",
    refreshExpiresAt: FUTURE,
    revokedAt: null,
    userIsActive: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  updateReturningQueue.length = 0;
  selectQueue.length = 0;
  insertedRows.length = 0;
  updateCalls.length = 0;
});

describe("issueTokens", () => {
  it("returns prefixed high-entropy tokens and stores only hashes", async () => {
    const tokens = await issueTokens({ clientRowId: 1, userId: 42, scope: "mcp:read" });

    expect(tokens.accessToken).toMatch(/^mcp_at_[A-Za-z0-9_-]{43}$/);
    expect(tokens.refreshToken).toMatch(/^mcp_rt_[A-Za-z0-9_-]{43}$/);
    expect(tokens.expiresIn).toBe(3600);

    const stored = insertedRows[0].values as Record<string, unknown>;
    expect(stored.accessTokenHash).toBe(sha256Hex(tokens.accessToken));
    expect(stored.refreshTokenHash).toBe(sha256Hex(tokens.refreshToken));
    expect(JSON.stringify(stored)).not.toContain(tokens.accessToken);
    expect(typeof stored.familyId).toBe("string");
  });
});

describe("rotateRefreshToken", () => {
  it("rejects an unknown refresh token", async () => {
    selectQueue.push([]);
    expect(await rotateRefreshToken("mcp_rt_x", 1)).toEqual({
      ok: false,
      error: "invalid_grant",
    });
  });

  it("rejects a token presented by a different client", async () => {
    selectQueue.push([tokenRow({ clientId: 99 })]);
    expect((await rotateRefreshToken("mcp_rt_x", 1)).ok).toBe(false);
  });

  it("revokes the whole family when a revoked token is replayed", async () => {
    selectQueue.push([tokenRow({ revokedAt: PAST })]);
    const result = await rotateRefreshToken("mcp_rt_x", 1);
    expect(result.ok).toBe(false);
    // One revocation update fired (the family), no new tokens inserted.
    expect(updateCalls.length).toBe(1);
    expect(insertedRows.length).toBe(0);
  });

  it("rejects an expired refresh token", async () => {
    selectQueue.push([tokenRow({ refreshExpiresAt: PAST })]);
    expect((await rotateRefreshToken("mcp_rt_x", 1)).ok).toBe(false);
  });

  it("rejects when the user behind the grant is no longer active", async () => {
    selectQueue.push([tokenRow({ userIsActive: false })]);
    expect((await rotateRefreshToken("mcp_rt_x", 1)).ok).toBe(false);
  });

  it("rotates within the same family on success", async () => {
    selectQueue.push([tokenRow()]);
    updateReturningQueue.push([{ id: 11 }]); // conditional revoke matched

    const result = await rotateRefreshToken("mcp_rt_x", 1);
    if (!result.ok) throw new Error("expected rotation to succeed");
    expect(result.tokens.refreshToken).toMatch(/^mcp_rt_/);

    const stored = insertedRows[0].values as Record<string, unknown>;
    expect(stored.familyId).toBe("fam-1");
    expect(stored.userId).toBe(42);
    expect(stored.scope).toBe("mcp:read");
  });

  it("revokes the family when losing a concurrent-rotation race", async () => {
    selectQueue.push([tokenRow()]);
    updateReturningQueue.push([]); // conditional revoke matched no rows

    const result = await rotateRefreshToken("mcp_rt_x", 1);
    expect(result).toEqual({ ok: false, error: "invalid_grant" });
    // Two updates fired (failed conditional revoke + family revocation),
    // no successor tokens inserted.
    expect(updateCalls.length).toBe(2);
    expect(insertedRows.length).toBe(0);
  });
});

describe("verifyAccessToken", () => {
  it("returns null for an unknown token", async () => {
    selectQueue.push([]);
    expect(await verifyAccessToken("mcp_at_x")).toBeNull();
  });

  it("maps a live token row to the verified identity including the live role", async () => {
    selectQueue.push([
      {
        tokenId: 11,
        userId: 42,
        scope: "mcp:read",
        lastUsedAt: new Date(),
        email: "jane@example.com",
        name: "Jane",
        role: "viewer",
        clientPublicId: "mcp_client_abc",
      },
    ]);
    expect(await verifyAccessToken("mcp_at_x")).toEqual({
      userId: 42,
      email: "jane@example.com",
      name: "Jane",
      role: "viewer",
      clientPublicId: "mcp_client_abc",
      scope: "mcp:read",
    });
  });
});
