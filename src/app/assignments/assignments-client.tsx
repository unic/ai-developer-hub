"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import {
  assignLicense,
  revokeLicense,
  updateAssignment,
} from "@/actions/assignments";
import { getToolWithTiers } from "@/actions/tools";
import { updateAssignmentSchema } from "@/lib/validators";
import type { UpdateAssignmentInput } from "@/lib/validators";
import { DataTable } from "@/components/data-table";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
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
} from "lucide-react";

interface AssignmentRow {
  id: number;
  status: string;
  costAtAssignmentCents: number;
  assignedAt: Date | null;
  revokedAt: Date | null;
  workspace: string | null;
  apiKeyEncrypted: string | null;
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
        ? new Date(assignment.assignedAt).toISOString()
        : undefined,
      workspace: assignment.workspace ?? "",
      apiKey: "",
    },
  });

  const watchedAssignedAt = form.watch("assignedAt");

  // Compute whether the selected date is > 12 months in the past
  const dateWarning = (() => {
    if (!watchedAssignedAt) return false;
    const selectedDate = new Date(watchedAssignedAt);
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
          ? new Date(assignment.assignedAt).toISOString()
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
      await navigator.clipboard.writeText(value);
      toast.success("Copied to clipboard");
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
                            ? format(new Date(field.value), "PPP")
                            : "Pick a date"}
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        captionLayout="dropdown"
                        selected={field.value ? new Date(field.value) : undefined}
                        onSelect={(date) => {
                          if (date) {
                            field.onChange(date.toISOString());
                          }
                          setDatePickerOpen(false);
                        }}
                        disabled={(date) => date > new Date()}
                        defaultMonth={
                          field.value ? new Date(field.value) : undefined
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
                      tabIndex={-1}
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
                      tabIndex={-1}
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

  async function handleRevoke(id: number) {
    const result = await revokeLicense({ id });
    if (result.success) {
      toast.success("License revoked");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  const columns: ColumnDef<AssignmentRow>[] = [
    {
      accessorFn: (row) => row.user.name,
      id: "userName",
      header: "User",
    },
    {
      accessorFn: (row) => row.tool.name,
      id: "toolName",
      header: "Tool",
    },
    {
      accessorFn: (row) => row.tier.name,
      id: "tierName",
      header: "Tier",
    },
    {
      accessorKey: "costAtAssignmentCents",
      header: "Monthly Cost",
      cell: ({ row }) => formatCurrency(row.original.costAtAssignmentCents),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge
          variant={
            row.original.status === "active" ? "default" : "secondary"
          }
        >
          {row.original.status}
        </Badge>
      ),
    },
    {
      accessorKey: "workspace",
      header: "Workspace",
      cell: ({ row }) => row.original.workspace || "\u2014",
    },
    {
      accessorKey: "assignedAt",
      header: "Assigned",
      cell: ({ row }) => formatDate(row.original.assignedAt),
    },
    {
      id: "actions" as const,
      cell: ({ row }: { row: { original: AssignmentRow } }) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" asChild>
            <Link href={`/assignments/${row.original.id}`}>View</Link>
          </Button>
          {isAdmin && row.original.status === "active" && (
            <>
              <EditAssignmentDialog
                assignment={row.original}
                onSaved={() => router.refresh()}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleRevoke(row.original.id)}
              >
                Revoke
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

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
                  <Select
                    value={selectedUserId}
                    onValueChange={setSelectedUserId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select user" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={String(u.id)}>
                          {u.name} ({u.email})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
        )}
      </div>
      <DataTable
        columns={columns}
        data={assignments}
        searchPlaceholder="Search assignments..."
      />
    </div>
  );
}
