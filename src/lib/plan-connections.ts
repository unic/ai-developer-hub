/**
 * Internal helpers for plan connections.
 * NOT a "use server" module — cannot be invoked as a server action from the client.
 */

import { db } from "@/lib/db";
import { anthropicPlanConnections } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { decryptApiKey } from "@/lib/crypto";

/**
 * Returns all active plan connections with their decrypted admin API keys.
 * Internal use only — never expose decrypted keys to the client.
 */
export async function getActivePlanConnections(): Promise<
  { id: number; label: string; adminApiKey: string }[]
> {
  const plans = await db
    .select()
    .from(anthropicPlanConnections)
    .where(eq(anthropicPlanConnections.status, "active"));

  return Promise.all(
    plans.map(async (plan) => ({
      id: plan.id,
      label: plan.label,
      adminApiKey: await decryptApiKey(plan.adminApiKeyEncrypted),
    }))
  );
}

/**
 * Returns the count of active plan connections.
 */
export async function getActivePlanCount(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(anthropicPlanConnections)
    .where(eq(anthropicPlanConnections.status, "active"));
  return row?.count ?? 0;
}
