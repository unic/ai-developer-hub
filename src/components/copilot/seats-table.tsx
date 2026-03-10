"use client";

import { ColumnDef } from "@tanstack/react-table";
import Image from "next/image";
import Link from "next/link";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { DataTableColumnHeader } from "@/components/data-table-column-header";

interface SeatRow {
  githubLogin: string;
  githubId: number;
  avatarUrl: string | null;
  assignedAt: string;
  lastActivityAt: string | null;
  lastActivityEditor: string | null;
  planType: "business" | "enterprise";
  status: "active" | "inactive" | "pending";
  matchedUserId: number | null;
  matchedUserName: string | null;
}

const columns: ColumnDef<SeatRow>[] = [
  {
    accessorKey: "githubLogin",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="User" />
    ),
    cell: ({ row }) => (
      <Link
        href={`/copilot/seats/${row.original.githubId}`}
        className="flex items-center gap-2 hover:underline"
      >
        {row.original.avatarUrl && (
          <Image
            src={row.original.avatarUrl}
            alt=""
            width={24}
            height={24}
            className="size-6 rounded-full"
            unoptimized
          />
        )}
        <span className="font-medium">{row.original.githubLogin}</span>
      </Link>
    ),
  },
  {
    accessorKey: "matchedUserName",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Matched User" />
    ),
    cell: ({ row }) =>
      row.original.matchedUserName ?? (
        <span className="text-muted-foreground">Unmatched</span>
      ),
  },
  {
    accessorKey: "planType",
    header: "Plan",
    cell: ({ row }) => (
      <Badge variant="outline" className="capitalize">
        {row.original.planType}
      </Badge>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const s = row.original.status;
      const variant =
        s === "active" ? "default" : s === "pending" ? "secondary" : "outline";
      return (
        <Badge variant={variant} className="capitalize">
          {s}
        </Badge>
      );
    },
    filterFn: "arrIncludesSome" as ColumnDef<SeatRow>["filterFn"],
  },
  {
    accessorKey: "assignedAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Assigned" />
    ),
    cell: ({ row }) =>
      new Date(row.original.assignedAt).toLocaleDateString(),
  },
];

interface SeatsTableProps {
  data: SeatRow[];
}

export function SeatsTable({ data }: SeatsTableProps) {
  return (
    <DataTable
      columns={columns}
      data={data}
      searchKey="githubLogin"
      searchPlaceholder="Search by GitHub login..."
    />
  );
}
