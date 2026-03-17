"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ColumnDef } from "@tanstack/react-table";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Eye, MoreHorizontal, Pencil, UserX, Mail, KeyRound } from "lucide-react";
import { deactivateUser } from "@/actions/users";
import { sendInviteEmail, resetUserPassword, sendBatchInviteEmails } from "@/actions/invite";
import { InviteLinkDialog } from "@/components/invite-link-dialog";
import type { User } from "@/types";

function UserRowActions({ row, isAdmin, onDeactivated }: { row: User; isAdmin: boolean; onDeactivated: () => void }) {
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetSendEmail, setResetSendEmail] = useState(true);
  const [showInviteLink, setShowInviteLink] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");

  async function handleSendInvite() {
    try {
      const result = await sendInviteEmail(row.id);
      if (result.success) {
        toast.success("Invite email sent");
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to send invite email");
    }
  }

  async function handleResetPassword() {
    try {
      const result = await resetUserPassword({ userId: row.id, sendEmail: resetSendEmail });
      if (result.success) {
        setShowResetDialog(false);
        setInviteUrl(result.data.inviteUrl);
        setShowInviteLink(true);
        if (result.data.emailSent) {
          toast.success("Password reset. Invite email sent.");
        } else {
          toast.success("Password reset. Share the invite link with the user.");
        }
        onDeactivated(); // refresh data
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("An unexpected error occurred");
    }
  }

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
      {isAdmin && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="ghost" aria-label={`Edit ${row.name}`} asChild>
              <Link href={`/users/${row.id}`}><Pencil className="size-4" /></Link>
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
              {row.mustChangePassword && (
                <DropdownMenuItem onSelect={handleSendInvite}>
                  <Mail className="size-4" />
                  Send Invite
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => {
                setResetSendEmail(true);
                setShowResetDialog(true);
              }}>
                <KeyRound className="size-4" />
                Reset Password
              </DropdownMenuItem>
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
          <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset password for {row.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will invalidate the current password and generate a new invite link.
                  The user will not be able to sign in until they set a new password via the invite link.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="flex items-center space-x-2 py-2">
                <Checkbox
                  id={`reset-email-${row.id}`}
                  checked={resetSendEmail}
                  onCheckedChange={(checked) => setResetSendEmail(checked === true)}
                />
                <Label htmlFor={`reset-email-${row.id}`}>
                  Send invite email to {row.email}
                </Label>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleResetPassword}>
                  Reset Password
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <InviteLinkDialog
            open={showInviteLink}
            onOpenChange={setShowInviteLink}
            inviteUrl={inviteUrl}
            userId={row.id}
          />
        </>
      )}
    </div>
  );
}

function getColumns(isAdmin: boolean, onDeactivated: () => void): ColumnDef<User>[] {
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
      accessorKey: "circle",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Circle" />,
      cell: ({ row }) => row.getValue("circle") || "\u2014",
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
      accessorKey: "profile",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Profile" />,
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
      id: "setupStatus",
      accessorFn: (row) => row.mustChangePassword ? "pending" : "active",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Setup Status" />,
      filterFn: arrayIncludesFilterFn,
      cell: ({ row }) => {
        const isPending = row.original.mustChangePassword;
        return isPending ? (
          <Badge variant="secondary">Pending</Badge>
        ) : (
          <span className="text-muted-foreground">Active</span>
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
        />
      ),
    },
  ];

  return columns;
}

const USERS_FACETED_FILTERS = [
  {
    columnId: "role",
    title: "Role",
    options: [
      { label: "Admin", value: "admin" },
      { label: "Viewer", value: "viewer" },
    ],
  },
  {
    columnId: "setupStatus",
    title: "Setup Status",
    options: [
      { label: "Active", value: "active" },
      { label: "Pending", value: "pending" },
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
  const [showNoCircle, setShowNoCircle] = useState(false);
  const [showBatchDialog, setShowBatchDialog] = useState(false);
  const [batchSending, setBatchSending] = useState(false);

  const handleRefresh = useCallback(() => router.refresh(), [router]);
  const columns = useMemo(() => getColumns(isAdmin, handleRefresh), [isAdmin, handleRefresh]);
  const filteredData = useMemo(
    () => showNoCircle ? data.filter((u) => !u.circle) : data,
    [showNoCircle, data]
  );

  const pendingCount = useMemo(
    () => data.filter((u) => u.mustChangePassword).length,
    [data]
  );

  async function handleBatchInvite() {
    setBatchSending(true);
    try {
      const result = await sendBatchInviteEmails();
      if (result.success) {
        const { sent, failed, total } = result.data;
        if (failed > 0) {
          toast.warning(`Sent ${sent} of ${total} invite emails. ${failed} failed.`);
        } else {
          toast.success(`Sent ${sent} invite email(s) to all pending users.`);
        }
        handleRefresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setBatchSending(false);
      setShowBatchDialog(false);
    }
  }

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
        {isAdmin && pendingCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowBatchDialog(true)}
          >
            <Mail className="mr-2 size-4" />
            Send Invites to All Pending ({pendingCount})
          </Button>
        )}
      </div>
      <DataTable
        columns={columns}
        data={filteredData}
        searchPlaceholder="Search users..."
        facetedFilters={USERS_FACETED_FILTERS}
      />
      <AlertDialog open={showBatchDialog} onOpenChange={setShowBatchDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send invites to all pending users?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send invite emails to {pendingCount} user(s) who have not yet set up their password.
              Each user will receive a unique invite link valid for 72 hours.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchSending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBatchInvite} disabled={batchSending}>
              {batchSending ? "Sending..." : "Send Invites"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
