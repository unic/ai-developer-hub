import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getBudgetWithCosts } from "@/actions/budget";
import { getRunningCostsForPeriod } from "@/lib/budget-utils";
import type { RunningCostsResult } from "@/lib/budget-utils";
import { BudgetDetailClient } from "../components/budget-detail-client";
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

  const budget = await getBudgetWithCosts(budgetId);
  if (!budget) notFound();

  const runningCostsResults = await Promise.all(
    budget.periods.map((p) => getRunningCostsForPeriod(p.id))
  );
  const runningCosts: Record<number, RunningCostsResult> = {};
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
        isAdmin={isAdmin}
        runningCosts={runningCosts}
        showBreadcrumb
      />
    </AuthGuard>
  );
}
