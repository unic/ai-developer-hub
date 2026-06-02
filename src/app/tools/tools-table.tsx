"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ColumnDef } from "@tanstack/react-table";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
import { DataTable, arrayIncludesFilterFn } from "@/components/data-table";
import { DataTableColumnHeader } from "@/components/data-table-column-header";
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
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Archive, Eye, MoreHorizontal, Pencil } from "lucide-react";
import { archiveTool } from "@/actions/tools";
import type { AiTool } from "@/types";

type ToolRow = AiTool & { activeLicenses: number };

function ToolRowActions({
  row,
  isAdmin,
  onArchived,
}: {
  row: ToolRow;
  isAdmin: boolean;
  onArchived: () => void;
}) {
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const status = useInlineStatus();

  // Viewers have no tool-detail access (page is admin-guarded) and no actions
  // to take here, so the entire actions column is hidden for them.
  if (!isAdmin) return null;

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="ghost" aria-label={`View ${row.name}`} asChild>
            <Link href={`/tools/${row.id}`}>
              <Eye className="size-4" />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>View</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="ghost" aria-label={`Edit ${row.name}`} asChild>
            <Link href={`/tools/${row.id}`}>
              <Pencil className="size-4" />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Edit</TooltipContent>
      </Tooltip>
      {row.status === "active" && (
        <>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" aria-label={`More actions for ${row.name}`}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>More actions</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setShowArchiveDialog(true)}
              >
                <Archive className="size-4" />
                Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <AlertDialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Archive {row.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  {row.activeLicenses > 0
                    ? `This tool has ${row.activeLicenses} active license(s). Revoke them before archiving.`
                    : "This will archive the tool and make it unavailable for new assignments."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <StatusText status={status.status} />
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={row.activeLicenses > 0}
                  onClick={async () => {
                    try {
                      const result = await archiveTool({ id: row.id });
                      if (result.success) {
                        status.ok("Archived");
                        onArchived();
                      } else {
                        status.error(result.error);
                      }
                    } catch {
                      status.error("Unexpected error");
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

function getColumns(isAdmin: boolean, onArchived: () => void): ColumnDef<ToolRow>[] {
  const columns: ColumnDef<ToolRow>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
      cell: ({ row }) =>
        isAdmin ? (
          <Link
            href={`/tools/${row.original.id}`}
            className="font-medium hover:underline"
          >
            {row.getValue("name")}
          </Link>
        ) : (
          <span className="font-medium">{row.getValue("name")}</span>
        ),
    },
    {
      accessorKey: "vendor",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
      filterFn: arrayIncludesFilterFn,
    },
    ...(isAdmin
      ? [
          {
            accessorKey: "activeLicenses",
            header: ({ column }: { column: import("@tanstack/react-table").Column<ToolRow> }) => (
              <DataTableColumnHeader column={column} title="Active Licenses" />
            ),
          } as ColumnDef<ToolRow>,
        ]
      : []),
    {
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      filterFn: arrayIncludesFilterFn,
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
        <ToolRowActions
          row={row.original}
          isAdmin={isAdmin}
          onArchived={onArchived}
        />
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
  const handleRefresh = useCallback(() => router.refresh(), [router]);
  const columns = useMemo(() => getColumns(isAdmin, handleRefresh), [isAdmin, handleRefresh]);

  const facetedFilters = useMemo(() => {
    const uniqueVendors = [...new Set(data.map((t) => t.vendor).filter(Boolean))]
      .sort()
      .map((v) => ({ label: v!, value: v! }));

    return [
      {
        columnId: "status",
        title: "Status",
        options: [
          { label: "Active", value: "active" },
          { label: "Archived", value: "archived" },
        ],
      },
      ...(uniqueVendors.length > 0
        ? [{ columnId: "vendor", title: "Vendor", options: uniqueVendors }]
        : []),
    ];
  }, [data]);

  return (
    <DataTable
      columns={columns}
      data={data}
      searchPlaceholder="Search tools..."
      facetedFilters={facetedFilters}
    />
  );
}
