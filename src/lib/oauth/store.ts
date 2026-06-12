/**
 * Persistence layer for the embedded OAuth 2.1 authorization server
 * (038-mcp-v2): client registrations, single-use authorization codes, and
 * access/refresh token pairs.
 *
 * Secrets are generated with high entropy (32 random bytes, base64url) and
 * only their SHA-256 hex digests are stored — the invite_tokens pattern. A
 * lookup by hash is therefore also constant-time with respect to the secret.
 *
 * Refresh tokens rotate: each refresh grant revokes the presented row and
 * inserts a successor sharing the same familyId. Presenting an already-revoked
 * refresh token is treated as theft and revokes the entire family
 * (RFC 9700 §4.14).
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  mcpOauthClients,
  mcpOauthCodes,
  mcpOauthTokens,
  users,
} from "@/lib/db/schema";

const AUTH_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const REFRESH_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

/**
 * Token prefixes. ACCESS_TOKEN_PREFIX is also used by verifyMcpToken to decide
 * whether a presented bearer token should be looked up in this store.
 */
export const ACCESS_TOKEN_PREFIX = "mcp_at_";
const REFRESH_TOKEN_PREFIX = "mcp_rt_";
const AUTH_CODE_PREFIX = "mcp_ac_";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function newSecret(prefix: string): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

// ---------------------------------------------------------------------------
// Clients (RFC 7591 dynamic registration)
// ---------------------------------------------------------------------------

export async function registerClient(input: {
  clientName: string;
  redirectUris: string[];
}) {
  const clientId = `mcp_client_${randomBytes(18).toString("base64url")}`;
  const [row] = await db
    .insert(mcpOauthClients)
    .values({
      clientId,
      clientName: input.clientName,
      redirectUris: input.redirectUris,
    })
    .returning();
  return row;
}

export async function getClientByPublicId(clientId: string) {
  return db.query.mcpOauthClients.findFirst({
    where: eq(mcpOauthClients.clientId, clientId),
  });
}

// ---------------------------------------------------------------------------
// Authorization codes
// ---------------------------------------------------------------------------

export async function issueAuthCode(input: {
  clientRowId: number;
  userId: number;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
}): Promise<string> {
  const code = newSecret(AUTH_CODE_PREFIX);
  await Promise.all([
    db.insert(mcpOauthCodes).values({
      codeHash: sha256Hex(code),
      clientId: input.clientRowId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      scope: input.scope,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    }),
    // Opportunistic cleanup — keeps the table from accumulating dead rows
    // without needing a cron job.
    db
      .delete(mcpOauthCodes)
      .where(
        lt(mcpOauthCodes.expiresAt, new Date(Date.now() - AUTH_CODE_TTL_MS)),
      ),
  ]);
  return code;
}

/**
 * Atomically consume an authorization code: the UPDATE only matches an
 * unconsumed, unexpired row bound to the presenting client, so a replayed
 * code, a race between two token requests, or a code presented by the wrong
 * client yields undefined — without burning a code that belongs to another
 * client.
 */
export async function consumeAuthCode(rawCode: string, clientRowId: number) {
  const [row] = await db
    .update(mcpOauthCodes)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(mcpOauthCodes.codeHash, sha256Hex(rawCode)),
        eq(mcpOauthCodes.clientId, clientRowId),
        isNull(mcpOauthCodes.consumedAt),
        gt(mcpOauthCodes.expiresAt, new Date()),
      ),
    )
    .returning();
  return row;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds (OAuth `expires_in`). */
  expiresIn: number;
  scope: string;
}

export async function issueTokens(input: {
  clientRowId: number;
  userId: number;
  scope: string;
  familyId?: string;
}): Promise<IssuedTokens> {
  const accessToken = newSecret(ACCESS_TOKEN_PREFIX);
  const refreshToken = newSecret(REFRESH_TOKEN_PREFIX);
  const now = Date.now();

  await db.insert(mcpOauthTokens).values({
    familyId: input.familyId ?? randomUUID(),
    accessTokenHash: sha256Hex(accessToken),
    refreshTokenHash: sha256Hex(refreshToken),
    clientId: input.clientRowId,
    userId: input.userId,
    scope: input.scope,
    accessExpiresAt: new Date(now + ACCESS_TOKEN_TTL_MS),
    refreshExpiresAt: new Date(now + REFRESH_TOKEN_TTL_MS),
  });

  await Promise.all([
    db
      .update(mcpOauthClients)
      .set({ lastUsedAt: new Date() })
      .where(eq(mcpOauthClients.id, input.clientRowId)),
    // Opportunistic cleanup of rows whose refresh window has fully lapsed.
    db
      .delete(mcpOauthTokens)
      .where(lt(mcpOauthTokens.refreshExpiresAt, new Date(now - 24 * 60 * 60 * 1000))),
  ]);

  return {
    accessToken,
    refreshToken,
    expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    scope: input.scope,
  };
}

export type RefreshResult =
  | { ok: true; tokens: IssuedTokens }
  | { ok: false; error: "invalid_grant" };

/**
 * Rotate a refresh token. The presented row is revoked and a successor is
 * issued within the same family. A revoked row being presented again means
 * the token leaked (or a very stale client) — the whole family is revoked.
 */
export async function rotateRefreshToken(
  rawRefreshToken: string,
  clientRowId: number,
): Promise<RefreshResult> {
  // Single round-trip: the token row plus whether its user is still active
  // (the join mirrors verifyAccessToken below).
  const [row] = await db
    .select({
      id: mcpOauthTokens.id,
      familyId: mcpOauthTokens.familyId,
      clientId: mcpOauthTokens.clientId,
      userId: mcpOauthTokens.userId,
      scope: mcpOauthTokens.scope,
      refreshExpiresAt: mcpOauthTokens.refreshExpiresAt,
      revokedAt: mcpOauthTokens.revokedAt,
      userIsActive: sql<boolean>`${users.status} = 'active'`,
    })
    .from(mcpOauthTokens)
    .innerJoin(users, eq(users.id, mcpOauthTokens.userId))
    .where(eq(mcpOauthTokens.refreshTokenHash, sha256Hex(rawRefreshToken)))
    .limit(1);

  if (!row || row.clientId !== clientRowId) return { ok: false, error: "invalid_grant" };

  if (row.revokedAt) {
    await revokeTokenFamily(row.familyId);
    return { ok: false, error: "invalid_grant" };
  }
  if (row.refreshExpiresAt <= new Date() || !row.userIsActive) {
    return { ok: false, error: "invalid_grant" };
  }

  // Atomic revoke: only matches the row while it is still unrevoked, so two
  // concurrent refreshes of the same token cannot both rotate. The loser is
  // indistinguishable from a replay and gets the same family revocation.
  const [revoked] = await db
    .update(mcpOauthTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(mcpOauthTokens.id, row.id), isNull(mcpOauthTokens.revokedAt)),
    )
    .returning({ id: mcpOauthTokens.id });
  if (!revoked) {
    await revokeTokenFamily(row.familyId);
    return { ok: false, error: "invalid_grant" };
  }

  const tokens = await issueTokens({
    clientRowId: row.clientId,
    userId: row.userId,
    scope: row.scope,
    familyId: row.familyId,
  });
  return { ok: true, tokens };
}

async function revokeTokenFamily(familyId: string): Promise<void> {
  await db
    .update(mcpOauthTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(mcpOauthTokens.familyId, familyId), isNull(mcpOauthTokens.revokedAt)),
    );
}

export interface VerifiedAccessToken {
  userId: number;
  email: string;
  name: string;
  /** Live role from the users row — re-read on every verification (039). */
  role: "admin" | "viewer";
  clientPublicId: string;
  scope: string;
}

/** Throttle for last_used_at writes — at most one update per row per 5 min. */
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Resolve a presented access token to its user, enforcing expiry, revocation,
 * and that the user account is still active.
 */
export async function verifyAccessToken(
  rawAccessToken: string,
): Promise<VerifiedAccessToken | null> {
  const [row] = await db
    .select({
      tokenId: mcpOauthTokens.id,
      userId: mcpOauthTokens.userId,
      scope: mcpOauthTokens.scope,
      lastUsedAt: mcpOauthTokens.lastUsedAt,
      email: users.email,
      name: users.name,
      role: users.role,
      clientPublicId: mcpOauthClients.clientId,
    })
    .from(mcpOauthTokens)
    .innerJoin(users, eq(users.id, mcpOauthTokens.userId))
    .innerJoin(
      mcpOauthClients,
      eq(mcpOauthClients.id, mcpOauthTokens.clientId),
    )
    .where(
      and(
        eq(mcpOauthTokens.accessTokenHash, sha256Hex(rawAccessToken)),
        isNull(mcpOauthTokens.revokedAt),
        gt(mcpOauthTokens.accessExpiresAt, new Date()),
        eq(users.status, "active"),
      ),
    )
    .limit(1);

  if (!row) return null;

  const lastUsed = row.lastUsedAt?.getTime() ?? 0;
  if (Date.now() - lastUsed > LAST_USED_WRITE_INTERVAL_MS) {
    // Fire-and-forget freshness marker for the settings UI.
    db.update(mcpOauthTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(mcpOauthTokens.id, row.tokenId))
      .catch(() => {});
  }

  return {
    userId: row.userId,
    email: row.email,
    name: row.name,
    role: row.role,
    clientPublicId: row.clientPublicId,
    scope: row.scope,
  };
}

// ---------------------------------------------------------------------------
// Grants (settings UI)
// ---------------------------------------------------------------------------

/**
 * A user's live grants — one row per token family that is neither revoked nor
 * past its refresh window. (Rotation revokes predecessors, so at most one
 * live row exists per family.)
 */
export async function listGrantsForUser(userId: number) {
  return db
    .select({
      familyId: mcpOauthTokens.familyId,
      clientName: mcpOauthClients.clientName,
      scope: mcpOauthTokens.scope,
      createdAt: mcpOauthTokens.createdAt,
      lastUsedAt: mcpOauthTokens.lastUsedAt,
      refreshExpiresAt: mcpOauthTokens.refreshExpiresAt,
    })
    .from(mcpOauthTokens)
    .innerJoin(
      mcpOauthClients,
      eq(mcpOauthClients.id, mcpOauthTokens.clientId),
    )
    .where(
      and(
        eq(mcpOauthTokens.userId, userId),
        isNull(mcpOauthTokens.revokedAt),
        gt(mcpOauthTokens.refreshExpiresAt, new Date()),
      ),
    )
    .orderBy(mcpOauthTokens.createdAt);
}

/** Revoke one of the caller's own grants (whole family). */
export async function revokeGrantForUser(
  userId: number,
  familyId: string,
): Promise<boolean> {
  const result = await db
    .update(mcpOauthTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(mcpOauthTokens.familyId, familyId),
        eq(mcpOauthTokens.userId, userId),
        isNull(mcpOauthTokens.revokedAt),
      ),
    )
    .returning({ id: mcpOauthTokens.id });
  return result.length > 0;
}
