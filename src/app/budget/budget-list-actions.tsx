"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Eye, Archive, MoreHorizontal } from "lucide-react";
import { archiveBudget } from "@/actions/budget";

interface BudgetListActionsProps {
  id: number;
  fiscalYear: number;
  status: string;
}

export function BudgetListActions({ id, fiscalYear, status }: BudgetListActionsProps) {
  const router = useRouter();
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const archiveStatus = useInlineStatus();

  return (
    <div className="flex items-center justify-end gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="ghost" aria-label={`View FY ${fiscalYear}`} asChild>
            <Link href={`/budget/${id}`}>
              <Eye className="size-4" />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>View</TooltipContent>
      </Tooltip>
      {status !== "archived" && (
        <>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" aria-label={`More actions for FY ${fiscalYear}`}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>More actions</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={() => setShowArchiveDialog(true)}>
                <Archive className="size-4" />
                Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <AlertDialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Archive FY {fiscalYear}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will archive the budget for fiscal year {fiscalYear}.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <StatusText status={archiveStatus.status} />
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={async () => {
                    try {
                      const result = await archiveBudget({ id });
                      if (result.success) {
                        router.refresh();
                      } else {
                        archiveStatus.error(result.error);
                      }
                    } catch {
                      archiveStatus.error("Unexpected error");
                    }
                  }}
                >
                  Archive
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
