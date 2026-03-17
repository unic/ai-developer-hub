"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable, arrayIncludesFilterFn } from "@/components/data-table";
import { DataTableColumnHeader } from "@/components/data-table-column-header";
import { EditUserDialog } from "@/components/edit-user-dialog";
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
import { Eye, MoreHorizontal, Pencil, UserX } from "lucide-react";
import { deactivateUser } from "@/actions/users";
import type { User } from "@/types";

function UserRowActions({
  row,
  isAdmin,
  onDeactivated,
  onEditUser,
}: {
  row: User;
  isAdmin: boolean;
  onDeactivated: () => void;
  onEditUser: (user: User) => void;
}) {
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="ghost" aria-label={`View ${row.name}`} asChild>
            <Link href={`/users/${row.id}`}><Eye className="size-4" /></Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>View</TooltipContent>
      </Tooltip>
      {isAdmin && row.status === "active" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Edit ${row.name}`}
              onClick={() => onEditUser(row)}
            >
              <Pencil className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit</TooltipContent>
        </Tooltip>
      )}
      {isAdmin && row.status === "active" && (
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
              <DropdownMenuItem variant="destructive" onSelect={() => setShowDeactivateDialog(true)}>
                <UserX className="size-4" />
                Deactivate
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <AlertDialog open={showDeactivateDialog} onOpenChange={setShowDeactivateDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Deactivate {row.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will deactivate the user and revoke all their active license assignments.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={async () => {
                  try {
                    const result = await deactivateUser({ id: row.id });
                    if (result.success) {
                      toast.success(`User deactivated. ${result.data.revokedCount} license(s) revoked.`);
                      onDeactivated();
                    } else {
                      toast.error(result.error);
                    }
                  } catch {
                    toast.error("An unexpected error occurred");
                  }
                }}>
                  Deactivate
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}

function getColumns(
  isAdmin: boolean,
  onDeactivated: () => void,
  onEditUser: (user: User) => void
): ColumnDef<User>[] {
  const columns: ColumnDef<User>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
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
      header: ({ column }) => <DataTableColumnHeader column={column} title="Email" />,
    },
    {
      accessorFn: (row) => row.circle ?? "__no_circle__",
      id: "circle",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Circle" />,
      filterFn: arrayIncludesFilterFn,
      cell: ({ row }) => {
        const value = row.getValue("circle") as string;
        return value === "__no_circle__" ? "\u2014" : value;
      },
    },
    {
      accessorKey: "role",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Role" />,
      filterFn: arrayIncludesFilterFn,
      cell: ({ row }) => (
        <Badge variant="outline" className="capitalize">
          {row.getValue("role") as string}
        </Badge>
      ),
    },
    {
      accessorFn: (row) => row.profile ?? "__no_profile__",
      id: "profile",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Profile" />,
      filterFn: arrayIncludesFilterFn,
      cell: ({ row }) => {
        const value = row.getValue("profile") as string;
        return value !== "__no_profile__" ? (
          <Badge variant="outline" className="capitalize">
            {value}
          </Badge>
        ) : (
          "\u2014"
        );
      },
    },
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
        <UserRowActions
          row={row.original}
          isAdmin={isAdmin}
          onDeactivated={onDeactivated}
          onEditUser={onEditUser}
        />
      ),
    },
  ];

  return columns;
}

const STATIC_FACETED_FILTERS = [
  {
    columnId: "role",
    title: "Role",
    options: [
      { label: "Admin", value: "admin" },
      { label: "Viewer", value: "viewer" },
    ],
  },
  {
    columnId: "status",
    title: "Status",
    options: [
      { label: "Active", value: "active" },
      { label: "Inactive", value: "inactive" },
    ],
  },
];

export function UsersTable({
  data,
  isAdmin,
}: {
  data: User[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const handleRefresh = useCallback(() => router.refresh(), [router]);
  const handleEditUser = useCallback((user: User) => {
    setEditingUser(user);
    setEditDialogOpen(true);
  }, []);
  const columns = useMemo(
    () => getColumns(isAdmin, handleRefresh, handleEditUser),
    [isAdmin, handleRefresh, handleEditUser]
  );

  const facetedFilters = useMemo(() => {
    const circles = [...new Set(data.map((u) => u.circle ?? "__no_circle__"))].sort();
    const circleOptions = circles.map((c) =>
      c === "__no_circle__"
        ? { label: "No Circle", value: "__no_circle__" }
        : { label: c, value: c }
    );

    const profileOptions = [
      { label: "Boost", value: "boost" },
      { label: "Maxed", value: "maxed" },
      { label: "Indie", value: "indie" },
      { label: "No Profile", value: "__no_profile__" },
    ];

    return [
      { columnId: "circle", title: "Circle", options: circleOptions },
      { columnId: "profile", title: "Profile", options: profileOptions },
      ...STATIC_FACETED_FILTERS,
    ];
  }, [data]);

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={data}
        searchPlaceholder="Search users..."
        facetedFilters={facetedFilters}
      />
      {editingUser && (
        <EditUserDialog
          user={editingUser}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          onSaved={handleRefresh}
        />
      )}
    </div>
  );
}
