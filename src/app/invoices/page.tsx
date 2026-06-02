import { requireAdmin } from "@/lib/auth-helpers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { invoices, users, billedCosts, budgetPeriods } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { InvoicesTable } from "./invoices-table";

export default async function InvoicesPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/login");

  const invoiceList = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      amountCents: invoices.amountCents,
      vendor: invoices.vendor,
      uploaderName: users.name,
      periodLabel: budgetPeriods.periodLabel,
    })
    .from(invoices)
    .leftJoin(users, eq(invoices.uploadedBy, users.id))
    .leftJoin(billedCosts, eq(invoices.linkedBilledCostId, billedCosts.id))
    .leftJoin(budgetPeriods, eq(billedCosts.periodId, budgetPeriods.id))
    .orderBy(desc(invoices.createdAt));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-medium tracking-tight text-ink">Invoices</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/invoices/bulk">Bulk Upload</Link>
          </Button>
          <Button asChild>
            <Link href="/invoices/new">Upload Invoice</Link>
          </Button>
        </div>
      </div>

      {invoiceList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-muted-foreground">No invoices archived yet.</p>
          <Button asChild className="mt-4">
            <Link href="/invoices/new">Upload your first invoice</Link>
          </Button>
        </div>
      ) : (
        <InvoicesTable data={invoiceList} />
      )}
    </div>
  );
}
