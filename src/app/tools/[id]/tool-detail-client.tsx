"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { updateTool, archiveTool, createTier, updateTier } from "@/actions/tools";
import { toolSchema, updateTierSchema, type ToolInput } from "@/lib/validators";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { AiTool, AccessTier, ChangeHistoryRecord } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Pencil, Plus } from "lucide-react";

interface Props {
  tool: AiTool;
  tiers: AccessTier[];
  activeAssignments: number;
  tierAssignmentCounts: { tierId: number; count: number }[];
  history: ChangeHistoryRecord[];
  isAdmin: boolean;
}

function EditTierDialog({
  tier,
  activeAssignmentCount,
}: {
  tier: AccessTier;
  activeAssignmentCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const tierForm = useForm({
    resolver: zodResolver(
      updateTierSchema.omit({ id: true })
    ),
    defaultValues: {
      name: tier.name,
      description: tier.description ?? "",
      monthlyCostCents: tier.monthlyCostCents,
      isActive: tier.isActive,
    },
  });

  // Reset form values when dialog opens (in case tier data changed via refresh)
  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      tierForm.reset({
        name: tier.name,
        description: tier.description ?? "",
        monthlyCostCents: tier.monthlyCostCents,
        isActive: tier.isActive,
      });
    }
    setOpen(nextOpen);
  }

  const watchIsActive = tierForm.watch("isActive");
  const cannotDeactivate = !watchIsActive && activeAssignmentCount > 0;

  async function onEditTierSubmit(data: {
    name?: string;
    description?: string;
    monthlyCostCents?: number;
    isActive?: boolean;
  }) {
    if (cannotDeactivate) return;

    const result = await updateTier({
      id: tier.id,
      name: data.name,
      description: data.description || undefined,
      monthlyCostCents: data.monthlyCostCents,
      isActive: data.isActive,
    });
    if (result.success) {
      toast.success("Tier updated");
      setOpen(false);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="size-8">
          <Pencil className="size-4" />
          <span className="sr-only">Edit tier</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Tier</DialogTitle>
          <DialogDescription>
            Update the details for the &ldquo;{tier.name}&rdquo; tier.
          </DialogDescription>
        </DialogHeader>
        <Form {...tierForm}>
          <form
            onSubmit={tierForm.handleSubmit(onEditTierSubmit)}
            className="space-y-4"
          >
            <FormField
              control={tierForm.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={tierForm.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={tierForm.control}
              name="monthlyCostCents"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Monthly Cost ($)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={field.value !== undefined ? (field.value / 100).toFixed(2) : ""}
                      onChange={(e) => {
                        const dollars = parseFloat(e.target.value);
                        field.onChange(
                          isNaN(dollars) ? 0 : Math.round(dollars * 100)
                        );
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={tierForm.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Active</FormLabel>
                    {cannotDeactivate && (
                      <p className="text-sm text-destructive">
                        Cannot deactivate: {activeAssignmentCount} active
                        assignment{activeAssignmentCount !== 1 ? "s" : ""} exist
                      </p>
                    )}
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
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
              <Button
                type="submit"
                disabled={tierForm.formState.isSubmitting || cannotDeactivate}
              >
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function ToolDetailClient({
  tool,
  tiers,
  activeAssignments,
  tierAssignmentCounts,
  history,
  isAdmin,
}: Props) {
  const router = useRouter();
  const [addTierOpen, setAddTierOpen] = useState(false);

  const form = useForm<ToolInput>({
    resolver: zodResolver(toolSchema),
    defaultValues: {
      name: tool.name,
      vendor: tool.vendor,
      description: tool.description ?? "",
      maxLicenses: tool.maxLicenses ?? undefined,
    },
  });

  async function onSubmit(data: ToolInput) {
    const result = await updateTool({ id: tool.id, ...data });
    if (result.success) {
      toast.success("Tool updated");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  async function handleArchive() {
    const result = await archiveTool({ id: tool.id });
    if (result.success) {
      toast.success("Tool archived");
      router.push("/tools");
    } else {
      toast.error(result.error);
    }
  }

  async function handleAddTier(formData: FormData) {
    const result = await createTier({
      toolId: tool.id,
      name: formData.get("tierName") as string,
      description: (formData.get("tierDescription") as string) || undefined,
      monthlyCostCents: Math.round(
        Number(formData.get("tierCost")) * 100
      ),
    });
    if (result.success) {
      toast.success("Tier added");
      setAddTierOpen(false);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{tool.name}</h1>
          <p className="text-muted-foreground">{tool.vendor}</p>
        </div>
        <Badge variant={tool.status === "active" ? "default" : "secondary"}>
          {tool.status}
        </Badge>
      </div>

      {isAdmin && tool.status === "active" && (
        <Card>
          <CardHeader>
            <CardTitle>Edit Tool</CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="vendor"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vendor</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="maxLicenses"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max Licenses</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="Unlimited"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex gap-3">
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    Save Changes
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive">Archive Tool</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Archive this tool?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {activeAssignments > 0
                            ? `This tool has ${activeAssignments} active license assignment(s). You must revoke all assignments before archiving.`
                            : "This will mark the tool as archived. It can no longer receive new assignments."}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleArchive}
                          disabled={activeAssignments > 0}
                        >
                          Archive
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Access Tiers</CardTitle>
            <CardDescription>
              {tiers.length} tier(s) &bull; {activeAssignments} active
              license(s)
            </CardDescription>
          </div>
          {isAdmin && (
            <Dialog open={addTierOpen} onOpenChange={setAddTierOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <Plus className="mr-2 size-4" />
                  Add Tier
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Tier</DialogTitle>
                </DialogHeader>
                <form action={handleAddTier} className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Name</label>
                    <Input name="tierName" required />
                  </div>
                  <div>
                    <label className="text-sm font-medium">
                      Monthly Cost ($)
                    </label>
                    <Input
                      name="tierCost"
                      type="number"
                      step="0.01"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Description</label>
                    <Input name="tierDescription" />
                  </div>
                  <Button type="submit">Add Tier</Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {tiers.map((tier) => {
              const assignCount =
                tierAssignmentCounts.find((c) => c.tierId === tier.id)?.count ??
                0;
              return (
                <div
                  key={tier.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{tier.name}</span>
                      {!tier.isActive && (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </div>
                    {tier.description && (
                      <p className="text-sm text-muted-foreground">
                        {tier.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="font-medium">
                        {formatCurrency(tier.monthlyCostCents)}/mo
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {assignCount} active
                      </p>
                    </div>
                    {isAdmin && (
                      <EditTierDialog
                        tier={tier}
                        activeAssignmentCount={assignCount}
                      />
                    )}
                  </div>
                </div>
              );
            })}
            {tiers.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No tiers defined yet.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change History</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length > 0 ? (
            <div className="space-y-3">
              {history.map((record) => (
                <div
                  key={record.id}
                  className="flex items-start gap-3 text-sm"
                >
                  <span className="text-muted-foreground whitespace-nowrap">
                    {formatDate(record.createdAt)}
                  </span>
                  <div>
                    <Badge variant="outline" className="text-xs">
                      {record.changeType}
                    </Badge>
                    {record.fieldName && (
                      <span className="ml-2">
                        <strong>{record.fieldName}</strong>
                        {record.previousValue && (
                          <>
                            {" "}
                            changed from{" "}
                            <code className="text-xs">
                              {record.previousValue}
                            </code>
                          </>
                        )}
                        {record.newValue && (
                          <>
                            {" "}
                            to{" "}
                            <code className="text-xs">{record.newValue}</code>
                          </>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No history recorded yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
