import { withSyncLock, type SyncCounts } from "@/lib/sync/framework";
import { db } from "@/lib/db";
import {
  invoices,
  billedCosts,
  budgetPeriods,
  annualBudgets,
} from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { recordCreation } from "@/lib/history";

interface RunOptions {
  dryRun?: boolean;
  triggeredByAdmin?: { id: string | number };
}

export async function run(
  triggeredBy?: number,
  opts?: RunOptions,
): Promise<{ eventId: number }> {
  return withSyncLock(
    {
      sourceType: "invoice_period_matching",
      triggeredBy,
      operationType: "regular",
    },
    async (eventId) => {
      const counts: SyncCounts = {
        createdCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        errorCount: 0,
      };

      const dryRun = opts?.dryRun ?? false;

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
        })
        .from(invoices)
        .leftJoin(billedCosts, eq(invoices.linkedBilledCostId, billedCosts.id))
        .leftJoin(budgetPeriods, eq(billedCosts.periodId, budgetPeriods.id))
        .where(eq(invoices.filteredOut, false));

      // Bulk-load all budget periods pre-sorted for matching
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
          .innerJoin(
            annualBudgets,
            eq(budgetPeriods.budgetId, annualBudgets.id),
          )
      ).sort((a, b) => {
        const aOrder = a.budgetStatus === "active" ? 0 : 1;
        const bOrder = b.budgetStatus === "active" ? 0 : 1;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return b.budgetCreatedAt.getTime() - a.budgetCreatedAt.getTime();
      });

      function findPeriodInMemory(invoiceDate: string) {
        return (
          allPeriods.find(
            (p) => p.startDate <= invoiceDate && p.endDate >= invoiceDate,
          ) ?? null
        );
      }

      for (const inv of allInvoices) {
        try {
          const correctPeriod = findPeriodInMemory(inv.invoiceDate);
          if (!correctPeriod) {
            counts.skippedCount++;
            continue;
          }

          if (!inv.linkedBilledCostId || !inv.currentPeriodId) {
            // Unlinked — newly link
            if (!dryRun) {
              await db.transaction(async (tx) => {
                const description = inv.vendor
                  ? `Invoice ${inv.invoiceNumber} — ${inv.vendor}`
                  : `Invoice ${inv.invoiceNumber}`;
                const [created] = await tx
                  .insert(billedCosts)
                  .values({
                    periodId: correctPeriod.id,
                    amountCents: inv.amountCents,
                    invoiceDate: inv.invoiceDate,
                    description,
                    vendorReference: inv.invoiceNumber,
                  })
                  .returning({ id: billedCosts.id });
                await tx
                  .update(invoices)
                  .set({
                    linkedBilledCostId: created.id,
                    updatedAt: new Date(),
                  })
                  .where(eq(invoices.id, inv.id));
                if (triggeredBy) {
                  await recordCreation("billed_cost", created.id, triggeredBy, {
                    tx,
                    source: "sync",
                  });
                }
              });
            }
            counts.createdCount++;
            continue;
          }

          if (inv.currentPeriodId === correctPeriod.id) {
            // Already correctly linked
            counts.skippedCount++;
            continue;
          }

          // Wrong period — correct
          if (!dryRun) {
            await db.transaction(async (tx) => {
              await tx
                .delete(billedCosts)
                .where(eq(billedCosts.id, inv.linkedBilledCostId!));
              const description = inv.vendor
                ? `Invoice ${inv.invoiceNumber} — ${inv.vendor}`
                : `Invoice ${inv.invoiceNumber}`;
              const [created] = await tx
                .insert(billedCosts)
                .values({
                  periodId: correctPeriod.id,
                  amountCents: inv.amountCents,
                  invoiceDate: inv.invoiceDate,
                  description,
                  vendorReference: inv.invoiceNumber,
                })
                .returning({ id: billedCosts.id });
              await tx
                .update(invoices)
                .set({ linkedBilledCostId: created.id, updatedAt: new Date() })
                .where(eq(invoices.id, inv.id));
              if (triggeredBy) {
                await recordCreation("billed_cost", created.id, triggeredBy, {
                  tx,
                  source: "sync",
                });
              }
            });
          }
          counts.createdCount++;
        } catch (err) {
          counts.errorCount++;
        }
      }

      return counts;
    },
  );
}
