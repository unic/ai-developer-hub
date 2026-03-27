"use server";

import { db } from "@/lib/db";
import { ingestionFilters, users } from "@/lib/db/schema";
import { eq, asc, desc, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-helpers";
import { revalidatePath } from "next/cache";
import {
  createIngestionFilterSchema,
  updateIngestionFilterSchema,
  deleteIngestionFilterSchema,
} from "@/lib/validators";
import type { ActionResult } from "@/types";

export interface IngestionFilterRow {
  id: number;
  name: string;
  field: "vendor" | "invoice_number";
  mode: "whitelist" | "blacklist";
  value: Record<string, unknown>;
  enabled: boolean;
  priority: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export async function getIngestionFilters(): Promise<
  ActionResult<IngestionFilterRow[]>
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const rows = await db
    .select({
      id: ingestionFilters.id,
      name: ingestionFilters.name,
      field: ingestionFilters.field,
      mode: ingestionFilters.mode,
      value: ingestionFilters.value,
      enabled: ingestionFilters.enabled,
      priority: ingestionFilters.priority,
      createdByName: users.name,
      createdAt: ingestionFilters.createdAt,
      updatedAt: ingestionFilters.updatedAt,
    })
    .from(ingestionFilters)
    .leftJoin(users, eq(ingestionFilters.createdBy, users.id))
    .orderBy(asc(ingestionFilters.priority), desc(ingestionFilters.createdAt));

  return {
    success: true,
    data: rows.map((r) => ({
      ...r,
      value: r.value as Record<string, unknown>,
      createdByName: r.createdByName ?? "Unknown",
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}

export async function createIngestionFilter(
  input: unknown
): Promise<ActionResult<{ id: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = createIngestionFilterSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  const { name, field, mode, value, enabled, priority } = parsed.data;

  const [created] = await db
    .insert(ingestionFilters)
    .values({
      name,
      field,
      mode,
      value,
      enabled: enabled ?? true,
      priority: priority ?? 0,
      createdBy: Number(admin.id),
    })
    .returning({ id: ingestionFilters.id });

  revalidatePath("/settings/ingestion");
  return { success: true, data: { id: created.id } };
}

export async function updateIngestionFilter(
  input: unknown
): Promise<ActionResult<{ id: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = updateIngestionFilterSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  const { id, ...updates } = parsed.data;
  const setValues: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.name !== undefined) setValues.name = updates.name;
  if (updates.mode !== undefined) setValues.mode = updates.mode;
  if (updates.value !== undefined) setValues.value = updates.value;
  if (updates.enabled !== undefined) setValues.enabled = updates.enabled;
  if (updates.priority !== undefined) setValues.priority = updates.priority;

  await db
    .update(ingestionFilters)
    .set(setValues)
    .where(eq(ingestionFilters.id, id));

  revalidatePath("/settings/ingestion");
  return { success: true, data: { id } };
}

export async function deleteIngestionFilter(
  id: number
): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = deleteIngestionFilterSchema.safeParse({ id });
  if (!parsed.success) {
    return { success: false, error: "Invalid filter ID" };
  }

  await db
    .delete(ingestionFilters)
    .where(eq(ingestionFilters.id, parsed.data.id));

  revalidatePath("/settings/ingestion");
  return { success: true, data: undefined };
}

export async function toggleIngestionFilter(
  id: number
): Promise<ActionResult<{ id: number; enabled: boolean }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const [updated] = await db
    .update(ingestionFilters)
    .set({
      enabled: sql`NOT ${ingestionFilters.enabled}`,
      updatedAt: new Date(),
    })
    .where(eq(ingestionFilters.id, id))
    .returning({
      id: ingestionFilters.id,
      enabled: ingestionFilters.enabled,
    });

  if (!updated) return { success: false, error: "Filter not found" };

  revalidatePath("/settings/ingestion");
  return { success: true, data: { id: updated.id, enabled: updated.enabled } };
}
