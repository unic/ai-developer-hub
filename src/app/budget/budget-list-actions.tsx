"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Eye, Archive } from "lucide-react";
import { archiveBudget } from "@/actions/budget";

interface BudgetListActionsProps {
  id: number;
  fiscalYear: number;
  status: string;
}

export function BudgetListActions({ id, fiscalYear, status }: BudgetListActionsProps) {
  const router = useRouter();

  return (
    <div className="flex items-center justify-end gap-1">
      <Button size="sm" variant="ghost" asChild>
        <Link href={`/budget/${id}`}>
          <Eye className="size-4" />
          <span className="sr-only">View</span>
        </Link>
      </Button>
      {status !== "archived" && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="ghost">
              <Archive className="size-4" />
              <span className="sr-only">Archive</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive FY {fiscalYear}?</AlertDialogTitle>
              <AlertDialogDescription>
                This will archive the budget for fiscal year {fiscalYear}.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  try {
                    const result = await archiveBudget({ id });
                    if (result.success) {
                      toast.success("Budget archived");
                      router.refresh();
                    } else {
                      toast.error(result.error);
                    }
                  } catch {
                    toast.error("An unexpected error occurred");
                  }
                }}
              >
                Archive
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
