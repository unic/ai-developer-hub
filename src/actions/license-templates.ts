"use server";

import { db } from "@/lib/db";
import { messageTemplates, aiTools, accessTiers } from "@/lib/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { messageTemplateSchema } from "@/lib/validators";
import type { ActionResult } from "@/types";

export interface MessageTemplateRow {
  id: number;
  toolId: number;
  toolName: string;
  tierId: number | null;
  tierName: string | null;
  kind: "approval" | "completion";
  bodyMd: string;
  updatedAt: Date;
}

export async function listMessageTemplates(): Promise<MessageTemplateRow[]> {
  const rows = await db
    .select({
      id: messageTemplates.id,
      toolId: messageTemplates.toolId,
      toolName: aiTools.name,
      tierId: messageTemplates.tierId,
      tierName: accessTiers.name,
      kind: messageTemplates.kind,
      bodyMd: messageTemplates.bodyMd,
      updatedAt: messageTemplates.updatedAt,
    })
    .from(messageTemplates)
    .leftJoin(aiTools, eq(messageTemplates.toolId, aiTools.id))
    .leftJoin(accessTiers, eq(messageTemplates.tierId, accessTiers.id))
    .orderBy(aiTools.name, messageTemplates.tierId, messageTemplates.kind);

  return rows.map((r) => ({
    id: r.id,
    toolId: r.toolId,
    toolName: r.toolName ?? "(unknown tool)",
    tierId: r.tierId,
    tierName: r.tierName,
    kind: r.kind,
    bodyMd: r.bodyMd,
    updatedAt: r.updatedAt,
  }));
}

export async function upsertMessageTemplate(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = messageTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { toolId, tierId, kind, bodyMd } = parsed.data;

  // Look up existing row using a partial-index-friendly match.
  const existing = await db.query.messageTemplates.findFirst({
    where: and(
      eq(messageTemplates.toolId, toolId),
      eq(messageTemplates.kind, kind),
      tierId === null ? isNull(messageTemplates.tierId) : eq(messageTemplates.tierId, tierId),
    ),
    columns: { id: true },
  });

  let id: number;
  if (existing) {
    await db
      .update(messageTemplates)
      .set({ bodyMd, updatedAt: new Date() })
      .where(eq(messageTemplates.id, existing.id));
    id = existing.id;
  } else {
    const [row] = await db
      .insert(messageTemplates)
      .values({ toolId, tierId, kind, bodyMd })
      .returning({ id: messageTemplates.id });
    id = row.id;
  }

  revalidatePath("/settings/license-templates");
  return { success: true, data: { id } };
}

export async function deleteMessageTemplate(
  input: { id: number },
): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  await db.delete(messageTemplates).where(eq(messageTemplates.id, input.id));
  revalidatePath("/settings/license-templates");
  return { success: true, data: undefined };
}

export interface ToolWithTiers {
  id: number;
  name: string;
  tiers: { id: number; name: string }[];
}

export async function listToolsWithTiers(): Promise<ToolWithTiers[]> {
  const rows = await db
    .select({
      toolId: aiTools.id,
      toolName: aiTools.name,
      tierId: accessTiers.id,
      tierName: accessTiers.name,
    })
    .from(aiTools)
    .leftJoin(accessTiers, eq(accessTiers.toolId, aiTools.id))
    .where(eq(aiTools.status, "active"))
    .orderBy(aiTools.name, accessTiers.name);

  const map = new Map<number, ToolWithTiers>();
  for (const r of rows) {
    let entry = map.get(r.toolId);
    if (!entry) {
      entry = { id: r.toolId, name: r.toolName, tiers: [] };
      map.set(r.toolId, entry);
    }
    if (r.tierId !== null && r.tierName !== null) {
      entry.tiers.push({ id: r.tierId, name: r.tierName });
    }
  }
  return Array.from(map.values());
}

/** Returns the union of form_payload top-level keys observed across the
 * most recent N license_requests for a given tool. Powers the variable
 * picker in the template editor. */
export async function recentFormKeysForTool(
  toolId: number,
  limit = 30,
): Promise<string[]> {
  // Run a raw aggregation — cheaper than fetching N JSONB blobs and unpacking
  // in JS, especially as the history grows.
  const result = await db.execute(sql`
    SELECT DISTINCT key
    FROM (
      SELECT jsonb_object_keys(form_payload) AS key
      FROM license_requests
      WHERE requested_tool_id = ${toolId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    ) sub
    ORDER BY key
  `);
  return (result.rows as { key: string }[]).map((r) => r.key);
}
