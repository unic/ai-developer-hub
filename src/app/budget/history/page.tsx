import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { getBudgets } from "@/actions/budget";
import { auth } from "@/lib/auth";
import { AuthGuard } from "@/components/auth-guard";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BudgetTable } from "../budget-table";

export default async function BudgetHistoryPage() {
  const session = await auth();
  const isAdmin = session?.user.role === "admin";
  const allBudgets = await getBudgets();

  return (
    <AuthGuard requiredRole="admin">
      <div className="space-y-6">
        <div className="space-y-2">
          <Button asChild variant="ghost" size="sm" className="-ml-3">
            <Link href="/budget">
              <ArrowLeft className="mr-1 size-3.5" />
              Back to active budget
            </Link>
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold">Budget history</h1>
              <p className="text-muted-foreground">
                Every fiscal year — active and archived.
              </p>
            </div>
            {isAdmin && (
              <Button asChild>
                <Link href="/budget/new">
                  <Plus className="mr-2 size-4" />
                  New Budget
                </Link>
              </Button>
            )}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All budgets</CardTitle>
          </CardHeader>
          <CardContent>
            {allBudgets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No budgets yet.{" "}
                {isAdmin && (
                  <Link
                    href="/budget/new"
                    className="text-primary hover:underline"
                  >
                    Create the first one.
                  </Link>
                )}
              </p>
            ) : (
              <BudgetTable data={allBudgets} />
            )}
          </CardContent>
        </Card>
      </div>
    </AuthGuard>
  );
}
