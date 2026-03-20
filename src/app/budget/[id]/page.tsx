import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getBudgetWithCosts,
  getPerToolSpend,
} from "@/actions/budget";
import { getRunningCostsForPeriod } from "@/actions/anthropic-usage";
import { BudgetDetailClient } from "./budget-detail-client";
import { AuthGuard } from "@/components/auth-guard";

export type RunningCostData = NonNullable<
  Awaited<ReturnType<typeof getRunningCostsForPeriod>>
>;

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

  const budget = await getBudgetWithCosts(budgetId);
  if (!budget) notFound();

  // Get per-tool breakdown for entire budget year
  const firstPeriod = budget.periods[0];
  const lastPeriod = budget.periods[budget.periods.length - 1];
  const toolBreakdown = firstPeriod && lastPeriod
    ? await getPerToolSpend(firstPeriod.startDate, lastPeriod.endDate)
    : [];

  // Fetch running costs for each period in parallel
  const runningCostsResults = await Promise.all(
    budget.periods.map((p) => getRunningCostsForPeriod(p.id))
  );
  const runningCosts: Record<number, RunningCostData> = {};
  budget.periods.forEach((p, i) => {
    const result = runningCostsResults[i];
    if (result) {
      runningCosts[p.id] = result;
    }
  });

  return (
    <AuthGuard requiredRole="admin">
      <BudgetDetailClient
        budget={budget}
        toolBreakdown={toolBreakdown}
        isAdmin={isAdmin}
        runningCosts={runningCosts}
      />
    </AuthGuard>
  );
}
