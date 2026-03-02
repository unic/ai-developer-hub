import Link from "next/link";
import { auth } from "@/lib/auth";
import { getActiveBudget, getBudgets } from "@/actions/budget";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";

export default async function BudgetPage() {
  const session = await auth();
  const isAdmin = session?.user.role === "admin";
  const activeBudget = await getActiveBudget();
  const allBudgets = await getBudgets();

  const totalAllocated =
    activeBudget?.periods.reduce((s, p) => s + p.plannedAmountCents, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Budget</h1>
          <p className="text-muted-foreground">
            Annual AI tool budget planning
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

      {activeBudget ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>FY {activeBudget.fiscalYear}</CardTitle>
                <CardDescription>
                  {activeBudget.periodType === "monthly"
                    ? "Monthly"
                    : "Quarterly"}{" "}
                  allocation
                </CardDescription>
              </div>
              <Badge>Active</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-sm text-muted-foreground">Total Budget</p>
                <p className="text-2xl font-bold">
                  {formatCurrency(activeBudget.totalAmountCents)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Allocated</p>
                <p className="text-2xl font-bold">
                  {formatCurrency(totalAllocated)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Unallocated</p>
                <p className="text-2xl font-bold">
                  {formatCurrency(
                    activeBudget.totalAmountCents - totalAllocated
                  )}
                </p>
              </div>
            </div>
            <Button asChild variant="outline">
              <Link href={`/budget/${activeBudget.id}`}>View Details</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">No active budget.</p>
            {isAdmin && (
              <Button asChild className="mt-4">
                <Link href="/budget/new">Create Annual Budget</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {allBudgets.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>All Budgets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {allBudgets.map((b) => (
                <Link
                  key={b.id}
                  href={`/budget/${b.id}`}
                  className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent"
                >
                  <span className="font-medium">FY {b.fiscalYear}</span>
                  <div className="flex items-center gap-2">
                    <span>{formatCurrency(b.totalAmountCents)}</span>
                    <Badge
                      variant={
                        b.status === "active" ? "default" : "secondary"
                      }
                    >
                      {b.status}
                    </Badge>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
