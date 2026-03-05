"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ColumnDef } from "@tanstack/react-table";
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
import { ArrowUpDown, Eye, Pencil, UserX } from "lucide-react";
import { deactivateUser } from "@/actions/users";
import type { User } from "@/types";

function getColumns(isAdmin: boolean, onDeactivated: () => void): ColumnDef<User>[] {
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
    {
      id: "actions",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" asChild>
            <Link href={`/users/${row.original.id}`}>
              <Eye className="size-4" />
              <span className="sr-only">View</span>
            </Link>
          </Button>
          {isAdmin && (
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/users/${row.original.id}`}>
                <Pencil className="size-4" />
                <span className="sr-only">Edit</span>
              </Link>
            </Button>
          )}
          {isAdmin && row.original.status === "active" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost">
                  <UserX className="size-4" />
                  <span className="sr-only">Deactivate</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Deactivate {row.original.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will deactivate the user and revoke all their active license assignments.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      const result = await deactivateUser({ id: row.original.id });
                      if (result.success) {
                        toast.success(`User deactivated. ${result.data.revokedCount} license(s) revoked.`);
                        onDeactivated();
                      } else {
                        toast.error(result.error);
                      }
                    }}
                  >
                    Deactivate
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

export function UsersTable({
  data,
  isAdmin,
}: {
  data: User[];
  isAdmin: boolean;
}) {
  const router = useRouter();
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
        columns={getColumns(isAdmin, () => router.refresh())}
        data={showNoCircle ? data.filter((u) => !u.circle) : data}
        searchPlaceholder="Search users..."
      />
    </div>
  );
}
