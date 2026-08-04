"use server";

import { db } from "@/lib/db";
import {
  invoices,
  billedCosts,
  budgetPeriods,
  annualBudgets,
} from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { syncOptionsSchema } from "@/lib/validators";
import { recordCreation } from "@/lib/history";
import { hashSourceType } from "@/lib/sync/framework";
import type { ActionResult, SyncInvoiceOutcome, SyncResult } from "@/types";

// Wrapper for backward compatibility — canonical location is budget-utils.ts
import { findPeriodForDate as _findPeriodForDate } from "@/lib/budget-utils";
export async function findPeriodForDate(invoiceDate: string) {
  return _findPeriodForDate(invoiceDate);
}

// Advisory lock ID derived from unified framework hash
const SYNC_LOCK_ID = Number(hashSourceType("invoice_period_matching"));

/**
 * Sync all invoices to their correct budget periods.
 * When dryRun is true, computes outcomes without writing to the database.
 * Uses a PostgreSQL advisory lock to prevent concurrent sync runs.
 */
export async function syncInvoices(options: {
  dryRun: boolean;
}): Promise<ActionResult<SyncResult>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = syncOptionsSchema.safeParse(options);
  if (!parsed.success) {
    return { success: false, error: "Invalid options" };
  }

  const { dryRun } = parsed.data;

  // Acquire advisory lock (non-blocking) to prevent concurrent sync runs
  if (!dryRun) {
    const lockRows = await db.execute(
      sql`SELECT pg_try_advisory_lock(${SYNC_LOCK_ID})`,
    );
    const acquired = (lockRows.rows?.[0] as Record<string, unknown>)
      ?.pg_try_advisory_lock;
    if (!acquired) {
      return {
        success: false,
        error: "Another sync is already in progress. Please try again later.",
      };
    }
  }

  try {
    return await executeSyncLogic(dryRun, admin);
  } finally {
    if (!dryRun) {
      await db.execute(sql`SELECT pg_advisory_unlock(${SYNC_LOCK_ID})`);
    }
  }
}

async function executeSyncLogic(
  dryRun: boolean,
  admin: { id: string | number },
): Promise<ActionResult<SyncResult>> {
  // Bulk-load all invoices with their linked billed cost's period
  const allInvoices = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      amountCents: invoices.amountCents,
      vendor: invoices.vendor,
      linkedBilledCostId: invoices.linkedBilledCostId,
      currentPeriodId: budgetPeriods.id,
      currentPeriodLabel: budgetPeriods.periodLabel,
    })
    .from(invoices)
    .leftJoin(billedCosts, eq(invoices.linkedBilledCostId, billedCosts.id))
    .leftJoin(budgetPeriods, eq(billedCosts.periodId, budgetPeriods.id))
    .where(eq(invoices.filteredOut, false));

  // Bulk-load all budget periods with parent budget status, pre-sorted for matching
  const allPeriods = (
    await db
      .select({
        id: budgetPeriods.id,
        periodLabel: budgetPeriods.periodLabel,
        startDate: budgetPeriods.startDate,
        endDate: budgetPeriods.endDate,
        budgetStatus: annualBudgets.status,
        budgetCreatedAt: annualBudgets.createdAt,
      })
      .from(budgetPeriods)
      .innerJoin(annualBudgets, eq(budgetPeriods.budgetId, annualBudgets.id))
  ).sort((a, b) => {
    const aOrder = a.budgetStatus === "active" ? 0 : 1;
    const bOrder = b.budgetStatus === "active" ? 0 : 1;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return b.budgetCreatedAt.getTime() - a.budgetCreatedAt.getTime();
  });

  // In-memory period matching — periods are pre-sorted so first match wins
  function findPeriodInMemory(
    invoiceDate: string,
  ): { id: number; periodLabel: string } | null {
    const match = allPeriods.find(
      (p) => p.startDate <= invoiceDate && p.endDate > invoiceDate,
    );
    return match ? { id: match.id, periodLabel: match.periodLabel } : null;
  }

  function buildDescription(invoiceNumber: string, vendor: string | null) {
    return vendor
      ? `Invoice ${invoiceNumber} — ${vendor}`
      : `Invoice ${invoiceNumber}`;
  }

  const items: SyncInvoiceOutcome[] = [];
  let verified = 0;
  let newlyLinked = 0;
  let corrected = 0;
  let unresolvable = 0;
  let errors = 0;

  for (const inv of allInvoices) {
    try {
      const correctPeriod = findPeriodInMemory(inv.invoiceDate);

      if (!correctPeriod) {
        // No matching period found
        unresolvable++;
        items.push({
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate,
          amountCents: inv.amountCents,
          vendor: inv.vendor,
          outcome: "unresolvable",
          previousPeriodLabel: inv.currentPeriodLabel,
          newPeriodLabel: null,
          reason: "No budget period covers this invoice date",
        });
        continue;
      }

      if (!inv.linkedBilledCostId || !inv.currentPeriodId) {
        // Unlinked invoice — newly link
        if (!dryRun) {
          await db.transaction(async (tx) => {
            const [created] = await tx
              .insert(billedCosts)
              .values({
                periodId: correctPeriod.id,
                amountCents: inv.amountCents,
                invoiceDate: inv.invoiceDate,
                description: buildDescription(inv.invoiceNumber, inv.vendor),
                vendorReference: inv.invoiceNumber,
              })
              .returning({ id: billedCosts.id });
            await tx
              .update(invoices)
              .set({ linkedBilledCostId: created.id, updatedAt: new Date() })
              .where(eq(invoices.id, inv.id));
            await recordCreation("billed_cost", created.id, Number(admin.id), {
              tx,
              source: "sync",
            });
          });
        }

        newlyLinked++;
        items.push({
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate,
          amountCents: inv.amountCents,
          vendor: inv.vendor,
          outcome: "newly_linked",
          previousPeriodLabel: null,
          newPeriodLabel: correctPeriod.periodLabel,
          reason: null,
        });
        continue;
      }

      if (inv.currentPeriodId === correctPeriod.id) {
        // Already correctly linked
        verified++;
        items.push({
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate,
          amountCents: inv.amountCents,
          vendor: inv.vendor,
          outcome: "verified",
          previousPeriodLabel: inv.currentPeriodLabel,
          newPeriodLabel: correctPeriod.periodLabel,
          reason: null,
        });
        continue;
      }

      // Linked to wrong period — correct
      if (!dryRun) {
        await db.transaction(async (tx) => {
          await tx
            .delete(billedCosts)
            .where(eq(billedCosts.id, inv.linkedBilledCostId!));
          const [created] = await tx
            .insert(billedCosts)
            .values({
              periodId: correctPeriod.id,
              amountCents: inv.amountCents,
              invoiceDate: inv.invoiceDate,
              description: buildDescription(inv.invoiceNumber, inv.vendor),
              vendorReference: inv.invoiceNumber,
            })
            .returning({ id: billedCosts.id });
          await tx
            .update(invoices)
            .set({ linkedBilledCostId: created.id, updatedAt: new Date() })
            .where(eq(invoices.id, inv.id));
          await recordCreation("billed_cost", created.id, Number(admin.id), {
            tx,
            source: "sync",
          });
        });
      }

      corrected++;
      items.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        amountCents: inv.amountCents,
        vendor: inv.vendor,
        outcome: "corrected",
        previousPeriodLabel: inv.currentPeriodLabel,
        newPeriodLabel: correctPeriod.periodLabel,
        reason: null,
      });
    } catch (err) {
      errors++;
      const message = err instanceof Error ? err.message : "Unknown error";
      items.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        amountCents: inv.amountCents,
        vendor: inv.vendor,
        outcome: "error",
        previousPeriodLabel: inv.currentPeriodLabel,
        newPeriodLabel: null,
        reason: message,
      });
    }
  }

  if (!dryRun) {
    revalidatePath("/invoices");
  }

  return {
    success: true,
    data: {
      totalProcessed: allInvoices.length,
      verified,
      newlyLinked,
      corrected,
      unresolvable,
      errors,
      items,
    },
  };
}
