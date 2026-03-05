import Link from "next/link";
import { auth } from "@/lib/auth";
import {
  getActiveBudget,
  getBudgets,
  getBudgetWithCosts,
} from "@/actions/budget";
import { formatCurrency, formatVariance, varianceClassName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus } from "lucide-react";
import { AuthGuard } from "@/components/auth-guard";
import { BudgetListActions } from "./budget-list-actions";

export default async function BudgetPage() {
  const session = await auth();
  const isAdmin = session?.user.role === "admin";
  const [activeBudget, allBudgets] = await Promise.all([
    getActiveBudget(),
    getBudgets(),
  ]);

  // Load full cost data for the active budget (depends on activeBudget)
  const activeBudgetWithCosts = activeBudget
    ? await getBudgetWithCosts(activeBudget.id)
    : null;

  const totalAllocated =
    activeBudgetWithCosts?.periods.reduce(
      (s, p) => s + p.plannedAmountCents,
      0
    ) ?? 0;
  const totalExpected =
    activeBudgetWithCosts?.periods.reduce(
      (s, p) => s + p.expectedSpendCents,
      0
    ) ?? 0;
  const totalBilled =
    activeBudgetWithCosts?.periods.reduce(
      (s, p) => s + p.billedTotalCents,
      0
    ) ?? 0;
  const billedVariance = totalBilled - totalExpected;

  return (
    <AuthGuard requiredRole="admin">
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

        {activeBudgetWithCosts ? (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>FY {activeBudgetWithCosts.fiscalYear}</CardTitle>
                  <CardDescription>
                    {activeBudgetWithCosts.periodType === "monthly"
                      ? "Monthly"
                      : "Quarterly"}{" "}
                    allocation
                  </CardDescription>
                </div>
                <Badge>Active</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
                <div>
                  <p className="text-sm text-muted-foreground">Total Budget</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(activeBudgetWithCosts.totalAmountCents)}
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
                      activeBudgetWithCosts.totalAmountCents - totalAllocated
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Expected</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(totalExpected)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Billed</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(totalBilled)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    Variance
                  </p>
                  <p
                    className={`text-2xl font-bold ${varianceClassName(billedVariance)}`}
                  >
                    {formatVariance(billedVariance)}
                  </p>
                </div>
              </div>
              <Button asChild variant="outline">
                <Link href={`/budget/${activeBudgetWithCosts.id}`}>
                  View Details
                </Link>
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
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fiscal Year</TableHead>
                      <TableHead>Planned</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allBudgets.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">
                          FY {b.fiscalYear}
                        </TableCell>
                        <TableCell>
                          {formatCurrency(b.totalAmountCents)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              b.status === "active" ? "default" : "secondary"
                            }
                          >
                            {b.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <BudgetListActions id={b.id} fiscalYear={b.fiscalYear} status={b.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AuthGuard>
  );
}
