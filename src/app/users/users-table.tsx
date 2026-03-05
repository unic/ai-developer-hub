"use client";

import { useState } from "react";
import Link from "next/link";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpDown } from "lucide-react";
import type { User } from "@/types";

function getColumns(isAdmin: boolean): ColumnDef<User>[] {
  const columns: ColumnDef<User>[] = [
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
          href={`/users/${row.original.id}`}
          className="font-medium hover:underline"
        >
          {row.getValue("name")}
        </Link>
      ),
    },
    {
      accessorKey: "email",
      header: "Email",
    },
    {
      accessorKey: "circle",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Circle
          <ArrowUpDown className="ml-2 size-4" />
        </Button>
      ),
      cell: ({ row }) => row.getValue("circle") || "\u2014",
    },
    {
      accessorKey: "role",
      header: "Role",
      cell: ({ row }) => (
        <Badge variant="outline" className="capitalize">
          {row.getValue("role") as string}
        </Badge>
      ),
    },
    {
      accessorKey: "profile",
      header: "Profile",
      cell: ({ row }) => {
        const profile = row.getValue("profile") as string | null;
        return profile ? (
          <Badge variant="outline" className="capitalize">
            {profile}
          </Badge>
        ) : (
          "\u2014"
        );
      },
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
  ];

  if (isAdmin) {
    columns.push({
      id: "actions",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" asChild>
            <Link href={`/users/${row.original.id}`}>Edit</Link>
          </Button>
        </div>
      ),
    });
  }

  return columns;
}

export function UsersTable({
  data,
  isAdmin,
}: {
  data: User[];
  isAdmin: boolean;
}) {
  const [showNoCircle, setShowNoCircle] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          variant={showNoCircle ? "secondary" : "outline"}
          size="sm"
          onClick={() => setShowNoCircle(!showNoCircle)}
        >
          No Circle
        </Button>
      </div>
      <DataTable
        columns={getColumns(isAdmin)}
        data={showNoCircle ? data.filter((u) => !u.circle) : data}
        searchPlaceholder="Search users..."
      />
    </div>
  );
}
