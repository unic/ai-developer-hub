"use server";

import { requireAdmin } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { aiTools, creditPurchases, invoices } from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordCreation, recordUpdate, recordDeletion } from "@/lib/history";
import { deriveCreditBalance, type CreditBalance } from "@/lib/credits";
import type { ActionResult } from "@/types";

/**
 * Credit purchases for prepaid, usage-based tools (045).
 *
 * A purchase is CASH LEAVING, not the cost of the month it lands in — the
 * consumption it funds happens on unrelated dates. Recording one is always an
 * explicit admin act: it is never inferred from an invoice's amount, vendor or
 * date, because a seat invoice and a credit top-up are both "Anthropic, PBC"
 * (research.md D9).
 */

const recordPurchaseSchema = z.object({
  toolId: z.number().int().positive(),
  invoiceId: z.number().int().positive().optional(),
  purchasedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  amountCents: z
    .number()
    .int()
    .positive("A purchase must be a positive amount"),
  note: z.string().max(200).optional(),
});

const openingBalanceSchema = z.object({
  toolId: z.number().int().positive(),
  // Nullable so an admin can clear a stale opening balance, which returns the
  // panel to "unavailable" rather than leaving a wrong number on screen.
  openingBalanceCents: z.number().int().nullable(),
  openingBalanceAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .nullable(),
});

function revalidateCreditSurfaces() {
  revalidatePath("/budget");
  revalidatePath("/claude");
  revalidatePath("/invoices");
}

export async function recordCreditPurchase(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = recordPurchaseSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Validation failed" };
  }
  const { toolId, invoiceId, purchasedAt, amountCents, note } = parsed.data;

  const tool = await db.query.aiTools.findFirst({
    where: eq(aiTools.id, toolId),
    columns: { id: true },
  });
  if (!tool) return { success: false, error: "Tool not found" };

  if (invoiceId !== undefined) {
    const invoice = await db.query.invoices.findFirst({
      where: eq(invoices.id, invoiceId),
      columns: { id: true },
    });
    if (!invoice) return { success: false, error: "Invoice not found" };

    const existing = await db.query.creditPurchases.findFirst({
      where: eq(creditPurchases.invoiceId, invoiceId),
      columns: { id: true },
    });
    if (existing) {
      return {
        success: false,
        error: "This invoice is already recorded as a credit purchase",
      };
    }
  }

  const [row] = await db
    .insert(creditPurchases)
    .values({
      toolId,
      invoiceId: invoiceId ?? null,
      purchasedAt,
      amountCents,
      note: note ?? null,
      createdBy: Number(admin.id),
    })
    .returning({ id: creditPurchases.id });

  await recordCreation("credit_purchase", row.id, Number(admin.id), {
    source: "ui",
  });

  revalidateCreditSurfaces();
  return { success: true, data: { id: row.id } };
}

/**
 * Undo a reclassification.
 *
 * Deleting the purchase row is all it takes: the invoice keeps its link to the
 * billed cost, which starts counting as period cost again. Nothing has to be
 * unpicked (C3).
 */
export async function deleteCreditPurchase(
  id: number,
): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const existing = await db.query.creditPurchases.findFirst({
    where: eq(creditPurchases.id, id),
  });
  if (!existing) return { success: false, error: "Credit purchase not found" };

  await db.delete(creditPurchases).where(eq(creditPurchases.id, id));
  await recordDeletion("credit_purchase", id, Number(admin.id), existing, {
    source: "ui",
  });

  revalidateCreditSurfaces();
  return { success: true, data: undefined };
}

/**
 * Record the balance an admin read in the vendor console, with the date they
 * read it.
 *
 * The Admin API exposes no credit balance, so this is the only way the Hub can
 * derive one — and the as-of date is what makes the drift visible when the
 * recorded figure goes stale.
 */
export async function setCreditOpeningBalance(
  input: unknown,
): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = openingBalanceSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Validation failed" };

  const { toolId, openingBalanceCents, openingBalanceAt } = parsed.data;

  // Both or neither: a balance without its as-of date cannot be reasoned
  // about, and a date without a balance says nothing.
  if ((openingBalanceCents === null) !== (openingBalanceAt === null)) {
    return {
      success: false,
      error: "An opening balance needs an as-of date, and vice versa",
    };
  }

  const tool = await db.query.aiTools.findFirst({
    where: eq(aiTools.id, toolId),
    columns: {
      id: true,
      creditOpeningBalanceCents: true,
      creditOpeningBalanceAt: true,
    },
  });
  if (!tool) return { success: false, error: "Tool not found" };

  await db
    .update(aiTools)
    .set({
      creditOpeningBalanceCents: openingBalanceCents,
      creditOpeningBalanceAt: openingBalanceAt,
      updatedAt: new Date(),
    })
    .where(eq(aiTools.id, toolId));

  await recordUpdate(
    "ai_tool",
    toolId,
    Number(admin.id),
    {
      creditOpeningBalanceCents: {
        old: tool.creditOpeningBalanceCents,
        new: openingBalanceCents,
      },
      creditOpeningBalanceAt: {
        old: tool.creditOpeningBalanceAt,
        new: openingBalanceAt,
      },
    },
    { source: "ui" },
  );

  revalidateCreditSurfaces();
  return { success: true, data: undefined };
}

export interface CreditPurchaseRow {
  id: number;
  purchasedAt: string;
  amountCents: number;
  note: string | null;
  invoiceNumber: string | null;
}

export interface LinkableInvoice {
  id: number;
  invoiceNumber: string;
  invoiceDate: string;
  amountCents: number;
}

export interface CreditPurchaseOverview {
  purchases: CreditPurchaseRow[];
  /** Recent vendor invoices not yet recorded as a credit purchase. */
  linkableInvoices: LinkableInvoice[];
}

/**
 * The recorded purchases for a tool, plus the invoices a new one could be
 * linked to. Candidates are offered, never picked: a seat invoice and a top-up
 * share a vendor, so only the admin can tell them apart (D9).
 */
export async function getCreditPurchaseOverview(
  toolId: number,
): Promise<ActionResult<CreditPurchaseOverview>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const tool = await db.query.aiTools.findFirst({
    where: eq(aiTools.id, toolId),
    columns: { id: true, vendor: true },
  });
  if (!tool) return { success: false, error: "Tool not found" };

  const purchases = await db
    .select({
      id: creditPurchases.id,
      purchasedAt: creditPurchases.purchasedAt,
      amountCents: creditPurchases.amountCents,
      note: creditPurchases.note,
      invoiceNumber: invoices.invoiceNumber,
    })
    .from(creditPurchases)
    .leftJoin(invoices, eq(invoices.id, creditPurchases.invoiceId))
    .where(eq(creditPurchases.toolId, toolId))
    .orderBy(desc(creditPurchases.purchasedAt), desc(creditPurchases.id));

  const linkableInvoices = (
    await db.execute(sql`
      SELECT i.id,
             i.invoice_number AS "invoiceNumber",
             i.invoice_date::text AS "invoiceDate",
             i.amount_cents AS "amountCents"
      FROM invoices i
      WHERE i.vendor ILIKE ${`%${tool.vendor}%`}
        AND i.filtered_out = false
        AND i.invoice_date >= CURRENT_DATE - INTERVAL '180 days'
        AND NOT EXISTS (
          SELECT 1 FROM credit_purchases cp WHERE cp.invoice_id = i.id
        )
      ORDER BY i.invoice_date DESC, i.id DESC
      LIMIT 50
    `)
  ).rows as unknown as LinkableInvoice[];

  return { success: true, data: { purchases, linkableInvoices } };
}

/** The derived balance for a tool, with everything it was derived from. */
export async function getCreditBalance(
  toolId: number,
): Promise<ActionResult<CreditBalance>> {
  const tool = await db.query.aiTools.findFirst({
    where: eq(aiTools.id, toolId),
    columns: {
      id: true,
      vendor: true,
      creditOpeningBalanceCents: true,
      creditOpeningBalanceAt: true,
    },
  });
  if (!tool) return { success: false, error: "Tool not found" };

  const purchases = await db
    .select({
      purchasedAt: creditPurchases.purchasedAt,
      amountCents: creditPurchases.amountCents,
    })
    .from(creditPurchases)
    .where(eq(creditPurchases.toolId, toolId));

  // Consumption is measured spend, not invoices — the whole point of the
  // separation. Only Anthropic is metered today.
  const consumptionByDay = new Map<string, number>();
  if (tool.vendor === "Anthropic") {
    const rows = (
      await db.execute(sql`
        SELECT date::text AS day, SUM(cost_cents)::bigint AS cents
        FROM anthropic_workspace_costs
        GROUP BY date
      `)
    ).rows as { day: string; cents: string }[];
    for (const row of rows) consumptionByDay.set(row.day, Number(row.cents));
  }

  return {
    success: true,
    data: deriveCreditBalance({
      toolId,
      openingCents: tool.creditOpeningBalanceCents,
      openingAt: tool.creditOpeningBalanceAt,
      purchases,
      consumptionByDay,
    }),
  };
}

/**
 * The credit balance for the metered Anthropic tool, for the Claude dashboard.
 *
 * Returns null when no Anthropic tool has a usage tier — there is then no
 * prepaid balance to speak of, which is different from one that is unavailable.
 */
export async function getAnthropicCreditBalance(): Promise<CreditBalance | null> {
  const rows = (
    await db.execute(sql`
      SELECT DISTINCT t.id
      FROM ai_tools t
      JOIN access_tiers ac ON ac.tool_id = t.id
      WHERE ac.pricing_model = 'usage' AND t.vendor = 'Anthropic'
      ORDER BY t.id
      LIMIT 1
    `)
  ).rows as { id: number }[];
  if (rows.length === 0) return null;

  const result = await getCreditBalance(rows[0].id);
  return result.success ? result.data : null;
}
