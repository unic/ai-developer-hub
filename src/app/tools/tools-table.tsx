"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
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
import { ArrowUpDown, Archive, Eye, Pencil } from "lucide-react";
import { archiveTool } from "@/actions/tools";
import type { AiTool } from "@/types";

type ToolRow = AiTool & { activeLicenses: number };

function getColumns(isAdmin: boolean, onArchived: () => void): ColumnDef<ToolRow>[] {
  const columns: ColumnDef<ToolRow>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Name
          <ArrowUpDown className="ml-2 size-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <Link
          href={`/tools/${row.original.id}`}
          className="font-medium hover:underline"
        >
          {row.getValue("name")}
        </Link>
      ),
    },
    {
      accessorKey: "vendor",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Vendor
          <ArrowUpDown className="ml-2 size-4" />
        </Button>
      ),
    },
    {
      accessorKey: "activeLicenses",
      header: "Active Licenses",
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge
          variant={
            row.getValue("status") === "active" ? "default" : "secondary"
          }
        >
          {row.getValue("status") as string}
        </Badge>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" asChild>
            <Link href={`/tools/${row.original.id}`}>
              <Eye className="size-4" />
              <span className="sr-only">View</span>
            </Link>
          </Button>
          {isAdmin && (
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/tools/${row.original.id}`}>
                <Pencil className="size-4" />
                <span className="sr-only">Edit</span>
              </Link>
            </Button>
          )}
          {isAdmin && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={row.original.status !== "active"}
                >
                  <Archive className="size-4" />
                  <span className="sr-only">Archive</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Archive {row.original.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {row.original.activeLicenses > 0
                      ? `This tool has ${row.original.activeLicenses} active license(s). Revoke them before archiving.`
                      : "This will archive the tool and make it unavailable for new assignments."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={row.original.activeLicenses > 0}
                    onClick={async () => {
                      const result = await archiveTool({ id: row.original.id });
                      if (result.success) {
                        toast.success("Tool archived");
                        onArchived();
                      } else {
                        toast.error(result.error);
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
      ),
    },
  ];

  return columns;
}

export function ToolsTable({
  data,
  isAdmin,
}: {
  data: ToolRow[];
  isAdmin: boolean;
}) {
  const router = useRouter();

  return (
    <DataTable
      columns={getColumns(isAdmin, () => router.refresh())}
      data={data}
      searchPlaceholder="Search tools..."
    />
  );
}
