import { randomBytes, createHash } from "crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { inviteTokens } from "@/lib/db/schema";
import { env } from "@/lib/env";

export const INVITE_EXPIRY_HOURS = 72;

export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex");
  const hash = hashToken(raw);
  return { raw, hash };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function buildInviteUrl(raw: string): string {
  const baseUrl =
    env.NEXTAUTH_URL ||
    (env.VERCEL_URL
      ? `https://${env.VERCEL_URL}`
      : "http://localhost:3000");
  return `${baseUrl}/setup-password/${raw}`;
}

/**
 * Mint an invite token for a user and return its live setup URL.
 *
 * Deliberately NOT in `src/actions/invite.ts`. It performs no auth check and no
 * user lookup by design — callers own that — and every export of a `"use server"`
 * file is a client-callable RPC endpoint. Exported from there, this was a
 * credential-minting endpoint: any client could POST a `userId` and receive a
 * working 72-hour /setup-password URL for that account. Same class of issue as
 * the audit writers moved to `src/lib/history.ts` in this spec.
 *
 * The authenticated entry points stay in `src/actions/invite.ts`
 * (generateInviteToken, resetUserPassword, sendInviteEmail, …); they call this
 * after their own `requireAdmin()`.
 *
 * Invalidates any existing active token for the user first, which is what makes
 * `invite_tokens_active_user_idx` (one active token per user) hold. The retry
 * covers the vanishingly rare raw-token collision.
 */
export async function createInviteTokenForUser(
  userId: number,
): Promise<{ inviteUrl: string }> {
  const { raw, hash: tokenHash } = generateToken();
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000);

  const maxRetries = 2;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(inviteTokens)
          .set({ status: "invalidated" })
          .where(
            and(
              eq(inviteTokens.userId, userId),
              eq(inviteTokens.status, "active"),
            ),
          );

        await tx.insert(inviteTokens).values({
          userId,
          tokenHash,
          status: "active",
          expiresAt,
        });
      });
      return { inviteUrl: buildInviteUrl(raw) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (
        attempt < maxRetries - 1 &&
        (msg.includes("unique") || msg.includes("duplicate"))
      ) {
        continue;
      }
      throw err;
    }
  }

  throw new Error("Failed to create invite token");
}
