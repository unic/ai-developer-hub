import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import type { BudgetWithCosts } from "@/types";

interface Props {
  budget: BudgetWithCosts;
  isAdmin: boolean;
  showBreadcrumb?: boolean;
}

export function BudgetDetailHeader({
  budget,
  isAdmin,
  showBreadcrumb = true,
}: Props) {
  const isArchived = budget.status === "archived";

  return (
    <div className="space-y-3">
      {showBreadcrumb && (
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/budget/history">Budget history</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>FY {budget.fiscalYear}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold">FY {budget.fiscalYear} Budget</h1>
          <Badge variant={isArchived ? "secondary" : "default"}>
            {budget.status}
          </Badge>
          <span className="text-sm text-muted-foreground capitalize">
            {budget.periodType} allocation
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/budget/history">
              All budgets
              <ArrowRight className="ml-1 size-3.5" />
            </Link>
          </Button>
          {isAdmin && !isArchived && (
            <Button asChild size="sm">
              <Link href="/budget/new">
                <Plus className="mr-1 size-4" />
                New Budget
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
