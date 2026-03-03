import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getBudgetById,
  getActualSpendForPeriod,
  getPerToolSpend,
} from "@/actions/budget";
import { BudgetDetailClient } from "./budget-detail-client";
import { AuthGuard } from "@/components/auth-guard";

export default async function BudgetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const budgetId = Number(id);
  if (isNaN(budgetId)) notFound();

  const session = await auth();
  const isAdmin = session?.user.role === "admin";

  const budget = await getBudgetById(budgetId);
  if (!budget) notFound();

  // Calculate actual spend per period
  const periodsWithActuals = await Promise.all(
    budget.periods.map(async (period) => {
      const actualSpend = await getActualSpendForPeriod(
        period.startDate,
        period.endDate
      );
      return { ...period, actualSpendCents: actualSpend };
    })
  );

  // Get per-tool breakdown for entire budget year
  const firstPeriod = budget.periods[0];
  const lastPeriod = budget.periods[budget.periods.length - 1];
  const toolBreakdown = firstPeriod && lastPeriod
    ? await getPerToolSpend(firstPeriod.startDate, lastPeriod.endDate)
    : [];

  return (
    <AuthGuard requiredRole="admin">
      <BudgetDetailClient
        budget={budget}
        periods={periodsWithActuals}
        toolBreakdown={toolBreakdown}
        isAdmin={isAdmin}
      />
    </AuthGuard>
  );
}
