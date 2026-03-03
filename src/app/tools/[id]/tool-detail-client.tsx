"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { updateTool, archiveTool, createTier, updateTier } from "@/actions/tools";
import { toolSchema, type ToolInput } from "@/lib/validators";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Plus } from "lucide-react";

interface Props {
  tool: AiTool;
  tiers: AccessTier[];
  activeAssignments: number;
  tierAssignmentCounts: { tierId: number; count: number }[];
  history: ChangeHistoryRecord[];
  isAdmin: boolean;
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
                  <div className="text-right">
                    <p className="font-medium">
                      {formatCurrency(tier.monthlyCostCents)}/mo
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {assignCount} active
                    </p>
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
