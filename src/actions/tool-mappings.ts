"use server";

// Tool-mapping CRUD (032-v2) — how (role, profile) from the request form
// resolves to a proposed tool. Seeded from the AI Tooling Guide via
// scripts/seed-tool-mappings.ts; edited here as the guide evolves.
// Resolution semantics live in src/lib/license-requests/mapping.ts.

import { db } from "@/lib/db";
import { toolMappings, aiTools, accessTiers } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { toolMappingSchema } from "@/lib/validators";
import type { ActionResult } from "@/types";

export interface ToolMappingRow {
  id: number;
  role: "developer" | "conception" | "business" | null;
  profile: "baseline" | "maxed" | "indie";
  toolId: number | null;
  toolName: string | null;
  defaultTierId: number | null;
  defaultTierName: string | null;
  updatedAt: Date;
}

export async function listToolMappings(): Promise<ToolMappingRow[]> {
  const rows = await db
    .select({
      id: toolMappings.id,
      role: toolMappings.role,
      profile: toolMappings.profile,
      toolId: toolMappings.toolId,
      toolName: aiTools.name,
      defaultTierId: toolMappings.defaultTierId,
      defaultTierName: accessTiers.name,
      updatedAt: toolMappings.updatedAt,
    })
    .from(toolMappings)
    .leftJoin(aiTools, eq(toolMappings.toolId, aiTools.id))
    .leftJoin(accessTiers, eq(toolMappings.defaultTierId, accessTiers.id))
    .orderBy(toolMappings.profile, toolMappings.role);

  return rows.map((r) => ({
    ...r,
    toolName: r.toolName ?? null,
    defaultTierName: r.defaultTierName ?? null,
  }));
}

/** Insert-or-update on the (role, profile) key — mirrors the partial unique
 * indexes, so Settings edits are idempotent per pair. */
export async function upsertToolMapping(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = toolMappingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Validation failed",
    };
  }
  const { role, profile, toolId, defaultTierId } = parsed.data;

  if (toolId !== null && defaultTierId !== null) {
    const tier = await db.query.accessTiers.findFirst({
      where: eq(accessTiers.id, defaultTierId),
      columns: { toolId: true },
    });
    if (!tier || tier.toolId !== toolId) {
      return { success: false, error: "Default tier does not belong to the selected tool." };
    }
  }

  const existing = await db.query.toolMappings.findFirst({
    where: and(
      role === null ? isNull(toolMappings.role) : eq(toolMappings.role, role),
      eq(toolMappings.profile, profile),
    ),
    columns: { id: true },
  });

  let id: number;
  if (existing) {
    await db
      .update(toolMappings)
      .set({ toolId, defaultTierId, updatedAt: new Date() })
      .where(eq(toolMappings.id, existing.id));
    id = existing.id;
  } else {
    const [row] = await db
      .insert(toolMappings)
      .values({ role, profile, toolId, defaultTierId })
      .returning({ id: toolMappings.id });
    id = row.id;
  }

  revalidatePath("/settings/tool-mapping");
  return { success: true, data: { id } };
}

/** Deleting a row degrades that (role, profile) to "needs decision" at ingest
 * — never an ingest failure. */
export async function deleteToolMapping(
  input: { id: number },
): Promise<ActionResult<{ id: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const id = Number(input?.id);
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid mapping id" };
  }

  const deleted = await db
    .delete(toolMappings)
    .where(eq(toolMappings.id, id))
    .returning({ id: toolMappings.id });
  if (deleted.length === 0) {
    return { success: false, error: "Mapping not found" };
  }

  revalidatePath("/settings/tool-mapping");
  return { success: true, data: { id } };
}
