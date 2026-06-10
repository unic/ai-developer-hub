import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getBudgetWithCosts } from "@/actions/budget";
import { getTools } from "@/actions/tools";
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

  const [runningCostsResults, allTools] = await Promise.all([
    Promise.all(budget.periods.map((p) => getRunningCostsForPeriod(p.id))),
    getTools(),
  ]);
  const runningCosts: Record<number, RunningCostsResult> = {};
  budget.periods.forEach((p, i) => {
    const result = runningCostsResults[i];
    if (result) {
      runningCosts[p.id] = result;
    }
  });
  const tools = allTools
    .filter((t) => t.status === "active")
    .map((t) => ({ id: t.id, name: t.name }));

  return (
    <AuthGuard requiredRole="admin">
      <BudgetDetailClient
        budget={budget}
        isAdmin={isAdmin}
        runningCosts={runningCosts}
        tools={tools}
        showBreadcrumb
      />
    </AuthGuard>
  );
}
