"use server";

import { db } from "@/lib/db";
import { anthropicPlanConnections } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-helpers";
import { decryptApiKey, encryptApiKey, maskApiKey } from "@/lib/crypto";
import { checkAnthropicStatus } from "@/actions/anthropic-status";
import { revalidatePath } from "next/cache";
import type { ActionResult, PlanConnectionListItem } from "@/types";

// ---------------------------------------------------------------------------
// getActivePlanConnections — internal helper (no auth, returns decrypted keys)
// ---------------------------------------------------------------------------

export async function getActivePlanConnections(): Promise<
  { id: number; label: string; adminApiKey: string }[]
> {
  const plans = await db
    .select()
    .from(anthropicPlanConnections)
    .where(eq(anthropicPlanConnections.status, "active"));

  const result: { id: number; label: string; adminApiKey: string }[] = [];
  for (const plan of plans) {
    const adminApiKey = await decryptApiKey(plan.adminApiKeyEncrypted);
    result.push({ id: plan.id, label: plan.label, adminApiKey });
  }
  return result;
}

// ---------------------------------------------------------------------------
// getPlanConnections — admin-only list of all connections
// ---------------------------------------------------------------------------

export async function getPlanConnections(): Promise<
  ActionResult<PlanConnectionListItem[]>
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const connections = await db
    .select({
      id: anthropicPlanConnections.id,
      label: anthropicPlanConnections.label,
      adminApiKeyHint: anthropicPlanConnections.adminApiKeyHint,
      status: anthropicPlanConnections.status,
      createdAt: anthropicPlanConnections.createdAt,
      disconnectedAt: anthropicPlanConnections.disconnectedAt,
    })
    .from(anthropicPlanConnections)
    .orderBy(anthropicPlanConnections.createdAt);

  return { success: true, data: connections };
}

// ---------------------------------------------------------------------------
// addPlanConnection — admin-only
// ---------------------------------------------------------------------------

export async function addPlanConnection(data: {
  label: string;
  adminApiKey: string;
}): Promise<ActionResult<{ id: number; label: string }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const label = data.label.trim();
  if (!label || label.length > 200) {
    return { success: false, error: "Label must be between 1 and 200 characters." };
  }
  if (!data.adminApiKey.trim()) {
    return { success: false, error: "Admin API key is required." };
  }

  // Check active connection count
  const activeCount = await db
    .select({ id: anthropicPlanConnections.id })
    .from(anthropicPlanConnections)
    .where(eq(anthropicPlanConnections.status, "active"));

  if (activeCount.length >= 10) {
    return { success: false, error: "Maximum of 10 active plan connections reached." };
  }

  // Check for duplicate key hint
  const hint = maskApiKey(data.adminApiKey);
  const existingHint = await db.query.anthropicPlanConnections.findFirst({
    where: eq(anthropicPlanConnections.adminApiKeyHint, hint),
  });
  if (existingHint && existingHint.status === "active") {
    return { success: false, error: "This API key is already connected to an active plan." };
  }

  // Verify the API key works
  const statusCheck = await checkAnthropicStatus(data.adminApiKey);
  if (!statusCheck.success || !statusCheck.data.connected) {
    return { success: false, error: "API key validation failed. Please check the key and try again." };
  }

  // Encrypt and store
  const encrypted = await encryptApiKey(data.adminApiKey);
  const [created] = await db
    .insert(anthropicPlanConnections)
    .values({
      label,
      adminApiKeyEncrypted: encrypted,
      adminApiKeyHint: hint,
      createdBy: Number(admin.id),
    })
    .returning({ id: anthropicPlanConnections.id, label: anthropicPlanConnections.label });

  revalidatePath("/settings/integrations");
  return { success: true, data: created };
}

// ---------------------------------------------------------------------------
// updatePlanConnectionLabel — admin-only
// ---------------------------------------------------------------------------

export async function updatePlanConnectionLabel(
  id: number,
  label: string
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const trimmed = label.trim();
  if (!trimmed || trimmed.length > 200) {
    return { success: false, error: "Label must be between 1 and 200 characters." };
  }

  const existing = await db.query.anthropicPlanConnections.findFirst({
    where: eq(anthropicPlanConnections.id, id),
  });
  if (!existing) return { success: false, error: "Plan connection not found." };

  await db
    .update(anthropicPlanConnections)
    .set({ label: trimmed, updatedAt: new Date() })
    .where(eq(anthropicPlanConnections.id, id));

  revalidatePath("/settings/integrations");
  return { success: true, data: undefined };
}

// ---------------------------------------------------------------------------
// disconnectPlanConnection — admin-only soft delete
// ---------------------------------------------------------------------------

export async function disconnectPlanConnection(
  id: number
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const existing = await db.query.anthropicPlanConnections.findFirst({
    where: eq(anthropicPlanConnections.id, id),
  });
  if (!existing || existing.status !== "active") {
    return { success: false, error: "Plan connection not found or already disconnected." };
  }

  // Prevent disconnecting the only active connection
  const activeCount = await db
    .select({ id: anthropicPlanConnections.id })
    .from(anthropicPlanConnections)
    .where(eq(anthropicPlanConnections.status, "active"));

  if (activeCount.length <= 1) {
    return { success: false, error: "Cannot disconnect the only active plan connection." };
  }

  await db
    .update(anthropicPlanConnections)
    .set({
      status: "disconnected",
      disconnectedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(anthropicPlanConnections.id, id));

  revalidatePath("/settings/integrations");
  return { success: true, data: undefined };
}
