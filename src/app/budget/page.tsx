import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { getActiveBudget, getBudgetWithCosts } from "@/actions/budget";
import { getRunningCostsForPeriod } from "@/lib/budget-utils";
import type { RunningCostsResult } from "@/lib/budget-utils";
import { AuthGuard } from "@/components/auth-guard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BudgetDetailClient } from "./components/budget-detail-client";

export default async function BudgetPage() {
  const session = await auth();
  const isAdmin = session?.user.role === "admin";
  const activeBudget = await getActiveBudget();

  if (!activeBudget) {
    return (
      <AuthGuard requiredRole="admin">
        <EmptyBudgetState isAdmin={isAdmin} />
      </AuthGuard>
    );
  }

  const budget = await getBudgetWithCosts(activeBudget.id);
  if (!budget) {
    return (
      <AuthGuard requiredRole="admin">
        <EmptyBudgetState isAdmin={isAdmin} />
      </AuthGuard>
    );
  }

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
        showBreadcrumb={false}
      />
    </AuthGuard>
  );
}

function EmptyBudgetState({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-medium tracking-tight text-ink">Budget</h1>
        <p className="text-muted-foreground">
          Annual AI tool budget planning.
        </p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-muted-foreground">
            No active budget for the current fiscal year.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {isAdmin && (
              <Button asChild>
                <Link href="/budget/new">
                  <Plus className="mr-2 size-4" />
                  Create Annual Budget
                </Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href="/budget/history">
                View past budgets
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
