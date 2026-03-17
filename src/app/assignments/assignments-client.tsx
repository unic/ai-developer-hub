"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ColumnDef } from "@tanstack/react-table";
import { format, parseISO } from "date-fns";
import {
  assignLicense,
  revokeLicense,
  updateAssignment,
} from "@/actions/assignments";
import { getToolWithTiers } from "@/actions/tools";
import { updateAssignmentSchema } from "@/lib/validators";
import type { UpdateAssignmentInput } from "@/lib/validators";
import { DataTable, arrayIncludesFilterFn } from "@/components/data-table";
import { UserCombobox } from "@/components/user-combobox";
import { formatCurrency, formatDate, cn, formatDateOnly, NO_WORKSPACE_SENTINEL } from "@/lib/utils";
import type { AiTool, User, AccessTier } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Plus,
  Pencil,
  Eye,
  EyeOff,
  Copy,
  CalendarIcon,
  AlertTriangle,
  Ban,
  MoreHorizontal,
} from "lucide-react";
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
import { DataTableColumnHeader } from "@/components/data-table-column-header";
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

interface AssignmentRow {
  id: number;
  status: string;
  costAtAssignmentCents: number;
  assignedAt: Date | null;
  revokedAt: Date | null;
  workspace: string | null;
  apiKeyEncrypted: string | null;
  source: string;
  user: { id: number; name: string; email: string };
  tool: { id: number; name: string };
  tier: { id: number; name: string };
}

// ---- Edit Assignment Dialog ----

interface EditAssignmentDialogProps {
  assignment: AssignmentRow;
  onSaved: () => void;
}

function EditAssignmentDialog({
  assignment,
  onSaved,
}: EditAssignmentDialogProps) {
  const [open, setOpen] = useState(false);
  const [tiers, setTiers] = useState<AccessTier[]>([]);
  const [loadingTiers, setLoadingTiers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const form = useForm<UpdateAssignmentInput>({
    resolver: zodResolver(updateAssignmentSchema),
    defaultValues: {
      id: assignment.id,
      tierId: assignment.tier.id,
      assignedAt: assignment.assignedAt
        ? formatDateOnly(new Date(assignment.assignedAt))
        : undefined,
      workspace: assignment.workspace ?? "",
      apiKey: "",
    },
  });

  const watchedAssignedAt = form.watch("assignedAt");

  // Compute whether the selected date is > 12 months in the past
  const dateWarning = (() => {
    if (!watchedAssignedAt) return false;
    const selectedDate = parseISO(watchedAssignedAt);
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    return selectedDate < twelveMonthsAgo;
  })();

  // Load tiers for the assignment's tool when the dialog opens
  const loadTiers = useCallback(async () => {
    setLoadingTiers(true);
    try {
      const tool = await getToolWithTiers(assignment.tool.id);
      setTiers(tool?.accessTiers.filter((t) => t.isActive) ?? []);
    } catch {
      toast.error("Failed to load tiers");
    } finally {
      setLoadingTiers(false);
    }
  }, [assignment.tool.id]);

  useEffect(() => {
    if (open) {
      loadTiers();
      // Reset form when dialog opens
      form.reset({
        id: assignment.id,
        tierId: assignment.tier.id,
        assignedAt: assignment.assignedAt
          ? formatDateOnly(new Date(assignment.assignedAt))
          : undefined,
        workspace: assignment.workspace ?? "",
        apiKey: "",
      });
      setShowApiKey(false);
    }
  }, [open, assignment, form, loadTiers]);

  async function onSubmit(data: UpdateAssignmentInput) {
    setSaving(true);
    try {
      // Only send apiKey if user actually typed something
      const payload: UpdateAssignmentInput = {
        id: data.id,
        tierId: data.tierId,
        assignedAt: data.assignedAt,
        workspace: data.workspace,
        ...(data.apiKey ? { apiKey: data.apiKey } : {}),
      };

      const result = await updateAssignment(payload);
      if (result.success) {
        if (result.warning) {
          toast.warning(result.warning);
        } else {
          toast.success("Assignment updated");
        }
        setOpen(false);
        onSaved();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyApiKey() {
    const value = form.getValues("apiKey");
    if (value) {
      try {
        await navigator.clipboard.writeText(value);
        toast.success("Copied to clipboard");
      } catch {
        toast.error("Failed to copy to clipboard");
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <Pencil className="size-4" />
          <span className="sr-only">Edit</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Assignment</DialogTitle>
          <DialogDescription>
            Update assignment for {assignment.user.name} &mdash;{" "}
            {assignment.tool.name}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Tier dropdown */}
            <FormField
              control={form.control}
              name="tierId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tier</FormLabel>
                  <Select
                    value={String(field.value)}
                    onValueChange={(val) => field.onChange(Number(val))}
                    disabled={loadingTiers || tiers.length === 0}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            loadingTiers ? "Loading tiers..." : "Select tier"
                          }
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {tiers.map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          {t.name} &mdash; {formatCurrency(t.monthlyCostCents)}
                          /mo
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Date picker */}
            <FormField
              control={form.control}
              name="assignedAt"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Assigned Date</FormLabel>
                  <Popover
                    open={datePickerOpen}
                    onOpenChange={setDatePickerOpen}
                  >
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !field.value && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 size-4" />
                          {field.value
                            ? format(parseISO(field.value), "PPP")
                            : "Pick a date"}
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        captionLayout="dropdown"
                        selected={field.value ? parseISO(field.value) : undefined}
                        onSelect={(date) => {
                          if (date) {
                            field.onChange(formatDateOnly(date));
                          }
                          setDatePickerOpen(false);
                        }}
                        disabled={(date) => date > new Date()}
                        defaultMonth={
                          field.value ? parseISO(field.value) : undefined
                        }
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Warning banner for old dates */}
            {dateWarning && (
              <Alert>
                <AlertTriangle className="size-4" />
                <AlertDescription>
                  This date is more than 12 months in the past.
                </AlertDescription>
              </Alert>
            )}

            {/* Workspace */}
            <FormField
              control={form.control}
              name="workspace"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Workspace</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. team-alpha"
                      maxLength={200}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* API Key */}
            <FormField
              control={form.control}
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>API Key</FormLabel>
                  <div className="flex gap-2">
                    <FormControl>
                      <Input
                        type={showApiKey ? "text" : "password"}
                        placeholder={
                          assignment.apiKeyEncrypted
                            ? "Enter new key to replace existing"
                            : "Enter API key"
                        }
                        {...field}
                      />
                    </FormControl>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowApiKey(!showApiKey)}
                    >
                      {showApiKey ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                      <span className="sr-only">
                        {showApiKey ? "Hide" : "Reveal"} API key
                      </span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={handleCopyApiKey}
                      disabled={!field.value}
                    >
                      <Copy className="size-4" />
                      <span className="sr-only">Copy API key</span>
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ---- Assignment Row Actions ----

function AssignmentRowActions({
  assignment,
  isAdmin,
  onRevoke,
  onSaved,
}: {
  assignment: AssignmentRow;
  isAdmin: boolean;
  onRevoke: (id: number) => void;
  onSaved: () => void;
}) {
  const [showRevokeDialog, setShowRevokeDialog] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`View ${assignment.user.name}'s assignment`}
            asChild
          >
            <Link href={`/assignments/${assignment.id}`}>
              <Eye className="size-4" />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>View</TooltipContent>
      </Tooltip>
      {isAdmin && assignment.status === "active" && assignment.source === "copilot-sync" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="ml-1 cursor-default text-xs text-muted-foreground">
              Managed by sync
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            This assignment is managed by Copilot sync and cannot be edited or revoked manually.
          </TooltipContent>
        </Tooltip>
      )}
      {isAdmin && assignment.status === "active" && assignment.source !== "copilot-sync" && (
        <>
          <EditAssignmentDialog assignment={assignment} onSaved={onSaved} />
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`More actions for ${assignment.user.name}'s assignment`}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>More actions</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setShowRevokeDialog(true)}
              >
                <Ban className="size-4" />
                Revoke
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <AlertDialog
            open={showRevokeDialog}
            onOpenChange={setShowRevokeDialog}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Revoke this assignment?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will revoke {assignment.user.name}&apos;s license for{" "}
                  {assignment.tool.name}.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => onRevoke(assignment.id)}>
                  Revoke
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}

// ---- Column Definitions ----

function getColumns(
  isAdmin: boolean,
  onRevoke: (id: number) => void,
  onSaved: () => void
): ColumnDef<AssignmentRow>[] {
  return [
    {
      accessorFn: (row) => row.user.name,
      id: "userName",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="User" />
      ),
    },
    {
      accessorFn: (row) => row.tool.name,
      id: "toolName",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Tool" />
      ),
      filterFn: arrayIncludesFilterFn,
    },
    {
      accessorFn: (row) => row.tier.name,
      id: "tierName",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Tier" />
      ),
      filterFn: arrayIncludesFilterFn,
    },
    {
      accessorKey: "costAtAssignmentCents",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Monthly Cost" />
      ),
      cell: ({ row }) => formatCurrency(row.original.costAtAssignmentCents),
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      filterFn: arrayIncludesFilterFn,
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <Badge
            variant={
              row.original.status === "active" ? "default" : "secondary"
            }
          >
            {row.original.status}
          </Badge>
          {row.original.source === "copilot-sync" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-xs">
                  Sync
                </Badge>
              </TooltipTrigger>
              <TooltipContent>Managed by Copilot sync</TooltipContent>
            </Tooltip>
          )}
        </div>
      ),
    },
    {
      accessorKey: "source",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Source" />
      ),
      filterFn: arrayIncludesFilterFn,
      cell: ({ row }) => (
        <Badge variant={row.original.source === "copilot-sync" ? "outline" : "secondary"}>
          {row.original.source === "copilot-sync" ? "Copilot Sync" : "Manual"}
        </Badge>
      ),
    },
    {
      accessorFn: (row) => row.workspace ?? NO_WORKSPACE_SENTINEL,
      id: "workspace",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Workspace" />
      ),
      filterFn: arrayIncludesFilterFn,
      cell: ({ row }) => {
        const value = row.getValue("workspace") as string;
        return value === NO_WORKSPACE_SENTINEL ? "\u2014" : value;
      },
    },
    {
      accessorKey: "assignedAt",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Assigned" />
      ),
      cell: ({ row }) => formatDate(row.original.assignedAt),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <AssignmentRowActions
          assignment={row.original}
          isAdmin={isAdmin}
          onRevoke={onRevoke}
          onSaved={onSaved}
        />
      ),
    },
  ];
}

const STATIC_ASSIGNMENT_FILTERS = [
  {
    columnId: "status",
    title: "Status",
    options: [
      { label: "Active", value: "active" },
      { label: "Revoked", value: "revoked" },
    ],
  },
  {
    columnId: "source",
    title: "Source",
    options: [
      { label: "Manual", value: "manual" },
      { label: "Copilot Sync", value: "copilot-sync" },
    ],
  },
];

// ---- Main Component ----

interface Props {
  assignments: AssignmentRow[];
  tools: AiTool[];
  users: User[];
  isAdmin: boolean;
}

export function AssignmentsClient({
  assignments,
  tools,
  users,
  isAdmin,
}: Props) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedToolId, setSelectedToolId] = useState<string>("");
  const [selectedTierId, setSelectedTierId] = useState<string>("");
  const [availableTiers, setAvailableTiers] = useState<AccessTier[]>([]);
  const [assigning, setAssigning] = useState(false);

  const handleRefresh = useCallback(() => router.refresh(), [router]);
  const handleRevoke = useCallback(async (id: number) => {
    const result = await revokeLicense({ id });
    if (result.success) {
      toast.success("License revoked");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }, [router]);
  const columns = useMemo(
    () => getColumns(isAdmin, handleRevoke, handleRefresh),
    [isAdmin, handleRevoke, handleRefresh]
  );

  const facetedFilters = useMemo(() => {
    const toolNames = [...new Set(assignments.map((a) => a.tool.name))].sort();
    const tierNames = [...new Set(assignments.map((a) => a.tier.name))].sort();
    const workspaces = [...new Set(assignments.map((a) => a.workspace ?? NO_WORKSPACE_SENTINEL))].sort();

    return [
      {
        columnId: "toolName",
        title: "Tool",
        options: toolNames.map((t) => ({ label: t, value: t })),
      },
      {
        columnId: "tierName",
        title: "Tier",
        options: tierNames.map((t) => ({ label: t, value: t })),
      },
      {
        columnId: "workspace",
        title: "Workspace",
        options: workspaces.map((w) =>
          w === NO_WORKSPACE_SENTINEL
            ? { label: "No Workspace", value: NO_WORKSPACE_SENTINEL }
            : { label: w, value: w }
        ),
      },
      ...STATIC_ASSIGNMENT_FILTERS,
    ];
  }, [assignments]);

  async function handleToolChange(toolId: string) {
    setSelectedToolId(toolId);
    setSelectedTierId("");
    if (toolId) {
      const tool = await getToolWithTiers(Number(toolId));
      setAvailableTiers(
        tool?.accessTiers.filter((t) => t.isActive) ?? []
      );
    } else {
      setAvailableTiers([]);
    }
  }

  async function handleAssign() {
    if (!selectedUserId || !selectedToolId || !selectedTierId) return;
    setAssigning(true);
    const result = await assignLicense({
      userId: Number(selectedUserId),
      toolId: Number(selectedToolId),
      tierId: Number(selectedTierId),
    });
    setAssigning(false);
    if (result.success) {
      toast.success("License assigned");
      setDialogOpen(false);
      setSelectedUserId("");
      setSelectedToolId("");
      setSelectedTierId("");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">License Assignments</h1>
          <p className="text-muted-foreground">
            Track user-to-tool license assignments
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/assignments/import">Bulk Import</Link>
            </Button>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 size-4" />
                  Assign License
                </Button>
              </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Assign License</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">User</label>
                  <UserCombobox
                    users={users}
                    value={selectedUserId}
                    onSelect={setSelectedUserId}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Tool</label>
                  <Select
                    value={selectedToolId}
                    onValueChange={handleToolChange}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select tool" />
                    </SelectTrigger>
                    <SelectContent>
                      {tools.map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Tier</label>
                  <Select
                    value={selectedTierId}
                    onValueChange={setSelectedTierId}
                    disabled={availableTiers.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select tier" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableTiers.map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          {t.name} — {formatCurrency(t.monthlyCostCents)}/mo
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleAssign}
                  disabled={
                    !selectedUserId ||
                    !selectedToolId ||
                    !selectedTierId ||
                    assigning
                  }
                  className="w-full"
                >
                  {assigning ? "Assigning..." : "Assign License"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          </div>
        )}
      </div>
      <DataTable
        columns={columns}
        data={assignments}
        searchPlaceholder="Search assignments..."
        facetedFilters={facetedFilters}
      />
    </div>
  );
}
