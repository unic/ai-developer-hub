"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ColumnDef } from "@tanstack/react-table";
import { formatDistanceToNow } from "date-fns";
import { DataTable, arrayIncludesFilterFn } from "@/components/data-table";
import { DataTableColumnHeader } from "@/components/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LicenseRequestRow } from "@/actions/license-requests";

const STATUS_LABELS: Record<LicenseRequestRow["status"], string> = {
  pending_review: "Pending review",
  approved: "Approved",
  completed: "Completed",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

function statusBadge(status: LicenseRequestRow["status"]) {
  const variantMap: Record<LicenseRequestRow["status"], "default" | "secondary" | "destructive" | "outline"> = {
    pending_review: "default",
    approved: "secondary",
    completed: "outline",
    rejected: "destructive",
    cancelled: "outline",
  };
  return <Badge variant={variantMap[status]}>{STATUS_LABELS[status]}</Badge>;
}

export function RequestsTable({ data }: { data: LicenseRequestRow[] }) {
  const columns = useMemo<ColumnDef<LicenseRequestRow>[]>(
    () => [
      {
        accessorKey: "id",
        header: ({ column }) => <DataTableColumnHeader column={column} title="ID" />,
        cell: ({ row }) => (
          <Link
            href={`/requests/${row.original.id}`}
            className="font-mono text-xs text-muted-foreground hover:underline"
          >
            REQ-{String(row.original.id).padStart(3, "0")}
          </Link>
        ),
      },
      {
        accessorKey: "requesterName",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Requester" />,
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.requesterName}</div>
            <div className="text-xs text-muted-foreground">{row.original.requesterEmail}</div>
          </div>
        ),
      },
      {
        id: "tool",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Tool / tier" />,
        accessorFn: (row) => row.requestedToolName,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span>{row.original.requestedToolName}</span>
            {row.original.requestedTierName && (
              <Badge variant="outline" className="text-[11px]">
                {row.original.requestedTierName}
              </Badge>
            )}
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => statusBadge(row.original.status),
        filterFn: arrayIncludesFilterFn,
      },
      {
        accessorKey: "decidedByName",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Decided by" />,
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.decidedByName ?? <span className="text-muted-foreground">—</span>}
          </span>
        ),
      },
      {
        id: "age",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Age" />,
        accessorFn: (row) => row.createdAt.getTime(),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(row.original.createdAt, { addSuffix: true })}
          </span>
        ),
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <Button size="sm" variant="ghost" asChild>
            <Link href={`/requests/${row.original.id}`}>Open</Link>
          </Button>
        ),
      },
    ],
    [],
  );

  const statusOptions = useMemo(
    () =>
      Object.entries(STATUS_LABELS).map(([value, label]) => ({
        value,
        label,
      })),
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={data}
      searchPlaceholder="Search by requester name or email…"
      facetedFilters={[
        {
          columnId: "status",
          title: "Status",
          options: statusOptions,
        },
      ]}
    />
  );
}
