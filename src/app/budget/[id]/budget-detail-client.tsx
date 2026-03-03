"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  updateBudgetAllocations,
  createBilledCost,
  updateBilledCost,
  deleteBilledCost,
} from "@/actions/budget";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { BudgetWithCosts, PeriodWithCosts, BilledCost } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  ChevronDown,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";

interface ToolSpend {
  toolId: number;
  toolName: string;
  totalCents: number;
  assignmentCount: number;
}

interface Props {
  budget: BudgetWithCosts;
  toolBreakdown: ToolSpend[];
  isAdmin: boolean;
}

// Billed cost form state
interface BilledCostFormState {
  amountDollars: string;
  invoiceDate: string;
  description: string;
  vendorReference: string;
}

const emptyBilledCostForm: BilledCostFormState = {
  amountDollars: "",
  invoiceDate: new Date().toISOString().split("T")[0],
  description: "",
  vendorReference: "",
};

export function BudgetDetailClient({
  budget,
  toolBreakdown,
  isAdmin,
}: Props) {
  const router = useRouter();
  const periods = budget.periods;
  const isArchived = budget.status === "archived";

  // Allocation editing state
  const [allocations, setAllocations] = useState<Record<number, number>>(
    Object.fromEntries(periods.map((p) => [p.id, p.plannedAmountCents]))
  );
  const [saving, setSaving] = useState(false);

  // Billed cost dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addPeriodId, setAddPeriodId] = useState<number | null>(null);
  const [addForm, setAddForm] = useState<BilledCostFormState>(emptyBilledCostForm);
  const [addSaving, setAddSaving] = useState(false);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<BilledCost | null>(null);
  const [editForm, setEditForm] = useState<BilledCostFormState>(emptyBilledCostForm);
  const [editSaving, setEditSaving] = useState(false);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteEntry, setDeleteEntry] = useState<BilledCost | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);

  // Expandable period rows
  const [expandedPeriods, setExpandedPeriods] = useState<Set<number>>(new Set());

  // Computed totals
  const totalAllocated = Object.values(allocations).reduce((s, v) => s + v, 0);
  const totalExpected = periods.reduce((s, p) => s + p.expectedSpendCents, 0);
  const totalBilled = periods.reduce((s, p) => s + p.billedTotalCents, 0);
  const totalBilledVariance = totalBilled - totalExpected;

  function togglePeriod(periodId: number) {
    setExpandedPeriods((prev) => {
      const next = new Set(prev);
      if (next.has(periodId)) {
        next.delete(periodId);
      } else {
        next.add(periodId);
      }
      return next;
    });
  }

  // Allocation save
  async function handleSave() {
    setSaving(true);
    const result = await updateBudgetAllocations({
      budgetId: budget.id,
      allocations: Object.entries(allocations).map(([periodId, amount]) => ({
        periodId: Number(periodId),
        plannedAmountCents: amount,
      })),
    });
    setSaving(false);

    if (result.success) {
      toast.success("Allocations saved");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  // Add billed cost
  function openAddDialog(periodId: number) {
    setAddPeriodId(periodId);
    setAddForm(emptyBilledCostForm);
    setAddDialogOpen(true);
  }

  async function handleAddBilledCost() {
    if (!addPeriodId) return;
    setAddSaving(true);
    const amountCents = Math.round(parseFloat(addForm.amountDollars) * 100);
    if (isNaN(amountCents) || amountCents <= 0) {
      toast.error("Please enter a valid amount");
      setAddSaving(false);
      return;
    }
    const result = await createBilledCost({
      periodId: addPeriodId,
      amountCents,
      invoiceDate: addForm.invoiceDate,
      description: addForm.description,
      vendorReference: addForm.vendorReference || undefined,
    });
    setAddSaving(false);
    if (result.success) {
      toast.success("Billed cost added");
      setAddDialogOpen(false);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  // Edit billed cost
  function openEditDialog(entry: BilledCost) {
    setEditEntry(entry);
    setEditForm({
      amountDollars: (entry.amountCents / 100).toFixed(2),
      invoiceDate: entry.invoiceDate,
      description: entry.description,
      vendorReference: entry.vendorReference ?? "",
    });
    setEditDialogOpen(true);
  }

  async function handleEditBilledCost() {
    if (!editEntry) return;
    setEditSaving(true);
    const amountCents = Math.round(parseFloat(editForm.amountDollars) * 100);
    if (isNaN(amountCents) || amountCents <= 0) {
      toast.error("Please enter a valid amount");
      setEditSaving(false);
      return;
    }
    const result = await updateBilledCost({
      id: editEntry.id,
      amountCents,
      invoiceDate: editForm.invoiceDate,
      description: editForm.description,
      vendorReference: editForm.vendorReference || null,
    });
    setEditSaving(false);
    if (result.success) {
      toast.success("Billed cost updated");
      setEditDialogOpen(false);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  // Delete billed cost
  function openDeleteDialog(entry: BilledCost) {
    setDeleteEntry(entry);
    setDeleteDialogOpen(true);
  }

  async function handleDeleteBilledCost() {
    if (!deleteEntry) return;
    setDeleteSaving(true);
    const result = await deleteBilledCost({ id: deleteEntry.id });
    setDeleteSaving(false);
    if (result.success) {
      toast.success("Billed cost deleted");
      setDeleteDialogOpen(false);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  function formatVariance(variance: number) {
    if (variance > 0) {
      return `+${formatCurrency(variance)}`;
    }
    if (variance < 0) {
      return `-${formatCurrency(Math.abs(variance))}`;
    }
    return formatCurrency(0);
  }

  function varianceClassName(variance: number) {
    if (variance > 0) return "text-destructive";
    if (variance < 0) return "text-muted-foreground";
    return "";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">FY {budget.fiscalYear} Budget</h1>
          <p className="text-muted-foreground capitalize">
            {budget.periodType} allocation
          </p>
        </div>
        <Badge variant={budget.status === "active" ? "default" : "secondary"}>
          {budget.status}
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-5">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Budget</p>
            <p className="text-2xl font-bold">
              {formatCurrency(budget.totalAmountCents)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Allocated</p>
            <p className="text-2xl font-bold">
              {formatCurrency(totalAllocated)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Expected Spend</p>
            <p className="text-2xl font-bold">
              {formatCurrency(totalExpected)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Billed</p>
            <p className="text-2xl font-bold">
              {formatCurrency(totalBilled)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Billed vs Expected</p>
            <p
              className={`text-2xl font-bold ${varianceClassName(totalBilledVariance)}`}
            >
              {formatVariance(totalBilledVariance)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Period Allocations &amp; Billed Costs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Period</TableHead>
                  <TableHead>Planned</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead>Billed</TableHead>
                  <TableHead>Variance (Billed - Expected)</TableHead>
                  <TableHead>% Diff</TableHead>
                  {isAdmin && !isArchived && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((period) => {
                  const planned = allocations[period.id] ?? 0;
                  const expected = period.expectedSpendCents;
                  const billed = period.billedTotalCents;
                  const variance = billed - expected;
                  const pctDiff =
                    expected > 0
                      ? Math.round(((billed - expected) / expected) * 100)
                      : 0;
                  const isOverBilled = billed > expected * 1.1;
                  const isExpanded = expandedPeriods.has(period.id);
                  const hasEntries =
                    period.billedEntries && period.billedEntries.length > 0;

                  return (
                    <>
                      <TableRow
                        key={period.id}
                        className={isOverBilled ? "bg-destructive/10" : ""}
                      >
                        <TableCell className="w-8 px-2">
                          {hasEntries ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-6"
                              onClick={() => togglePeriod(period.id)}
                            >
                              {isExpanded ? (
                                <ChevronDown className="size-4" />
                              ) : (
                                <ChevronRight className="size-4" />
                              )}
                            </Button>
                          ) : null}
                        </TableCell>
                        <TableCell className="font-medium">
                          {period.periodLabel}
                        </TableCell>
                        <TableCell>
                          {isAdmin && !isArchived ? (
                            <Input
                              type="number"
                              step="0.01"
                              className="w-28"
                              value={(
                                (allocations[period.id] ?? 0) / 100
                              ).toFixed(2)}
                              onChange={(e) => {
                                const cents = Math.round(
                                  Number(e.target.value) * 100
                                );
                                setAllocations((prev) => ({
                                  ...prev,
                                  [period.id]: cents,
                                }));
                              }}
                            />
                          ) : (
                            formatCurrency(planned)
                          )}
                        </TableCell>
                        <TableCell>{formatCurrency(expected)}</TableCell>
                        <TableCell>{formatCurrency(billed)}</TableCell>
                        <TableCell className={varianceClassName(variance)}>
                          {formatVariance(variance)}
                        </TableCell>
                        <TableCell>
                          {isOverBilled ? (
                            <Badge variant="destructive">{pctDiff}%</Badge>
                          ) : (
                            <span>{pctDiff}%</span>
                          )}
                        </TableCell>
                        {isAdmin && !isArchived && (
                          <TableCell className="px-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              onClick={() => openAddDialog(period.id)}
                              title="Add billed cost"
                            >
                              <Plus className="size-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                      {isExpanded &&
                        period.billedEntries?.map((entry) => (
                          <TableRow
                            key={`billed-${entry.id}`}
                            className="bg-muted/30"
                          >
                            <TableCell />
                            <TableCell
                              colSpan={2}
                              className="text-sm text-muted-foreground pl-8"
                            >
                              <span className="font-medium">
                                {entry.description}
                              </span>
                              {entry.vendorReference && (
                                <span className="ml-2 text-xs">
                                  (Ref: {entry.vendorReference})
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatDate(entry.invoiceDate)}
                            </TableCell>
                            <TableCell className="text-sm">
                              {formatCurrency(entry.amountCents)}
                            </TableCell>
                            <TableCell />
                            <TableCell />
                            {isAdmin && !isArchived && (
                              <TableCell className="px-2">
                                <div className="flex gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-6"
                                    onClick={() => openEditDialog(entry)}
                                    title="Edit"
                                  >
                                    <Pencil className="size-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-6 text-destructive"
                                    onClick={() => openDeleteDialog(entry)}
                                    title="Delete"
                                  >
                                    <Trash2 className="size-3" />
                                  </Button>
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                    </>
                  );
                })}
                <TableRow className="font-bold">
                  <TableCell />
                  <TableCell>YTD Total</TableCell>
                  <TableCell>{formatCurrency(totalAllocated)}</TableCell>
                  <TableCell>{formatCurrency(totalExpected)}</TableCell>
                  <TableCell>{formatCurrency(totalBilled)}</TableCell>
                  <TableCell className={varianceClassName(totalBilledVariance)}>
                    {formatVariance(totalBilledVariance)}
                  </TableCell>
                  <TableCell />
                  {isAdmin && !isArchived && <TableCell />}
                </TableRow>
              </TableBody>
            </Table>
          </div>
          {isAdmin && !isArchived && (
            <div className="mt-4 flex items-center gap-3">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save Allocations"}
              </Button>
              {totalAllocated > budget.totalAmountCents && (
                <p className="text-sm text-destructive">
                  Allocations exceed budget by{" "}
                  {formatCurrency(totalAllocated - budget.totalAmountCents)}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {toolBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Per-Tool Spending Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {toolBreakdown.map((tool) => {
                const pct =
                  totalExpected > 0
                    ? Math.round((tool.totalCents / totalExpected) * 100)
                    : 0;
                return (
                  <div
                    key={tool.toolId}
                    className="flex items-center justify-between"
                  >
                    <div>
                      <p className="font-medium">{tool.toolName}</p>
                      <p className="text-sm text-muted-foreground">
                        {tool.assignmentCount} license(s)
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">
                        {formatCurrency(tool.totalCents)}
                      </p>
                      <p className="text-sm text-muted-foreground">{pct}%</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add Billed Cost Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Billed Cost</DialogTitle>
            <DialogDescription>
              Record an actual billed cost for this period.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="add-amount">Amount ($)</Label>
              <Input
                id="add-amount"
                type="number"
                step="0.01"
                min="0.01"
                value={addForm.amountDollars}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, amountDollars: e.target.value }))
                }
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-date">Invoice Date</Label>
              <Input
                id="add-date"
                type="date"
                value={addForm.invoiceDate}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, invoiceDate: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-description">Description</Label>
              <Input
                id="add-description"
                value={addForm.description}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="e.g. GitHub Copilot Business - March invoice"
                maxLength={500}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-vendor-ref">
                Vendor Reference{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="add-vendor-ref"
                value={addForm.vendorReference}
                onChange={(e) =>
                  setAddForm((f) => ({
                    ...f,
                    vendorReference: e.target.value,
                  }))
                }
                placeholder="e.g. INV-2026-001"
                maxLength={255}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddBilledCost}
              disabled={
                addSaving ||
                !addForm.amountDollars ||
                !addForm.description ||
                !addForm.invoiceDate
              }
            >
              {addSaving ? "Adding..." : "Add Cost"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Billed Cost Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Billed Cost</DialogTitle>
            <DialogDescription>
              Update the details for this billed cost entry.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-amount">Amount ($)</Label>
              <Input
                id="edit-amount"
                type="number"
                step="0.01"
                min="0.01"
                value={editForm.amountDollars}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, amountDollars: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-date">Invoice Date</Label>
              <Input
                id="edit-date"
                type="date"
                value={editForm.invoiceDate}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, invoiceDate: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Input
                id="edit-description"
                value={editForm.description}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, description: e.target.value }))
                }
                maxLength={500}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-vendor-ref">
                Vendor Reference{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="edit-vendor-ref"
                value={editForm.vendorReference}
                onChange={(e) =>
                  setEditForm((f) => ({
                    ...f,
                    vendorReference: e.target.value,
                  }))
                }
                maxLength={255}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleEditBilledCost}
              disabled={
                editSaving ||
                !editForm.amountDollars ||
                !editForm.description ||
                !editForm.invoiceDate
              }
            >
              {editSaving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Billed Cost Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete billed cost?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the billed cost entry
              {deleteEntry
                ? ` "${deleteEntry.description}" (${formatCurrency(deleteEntry.amountCents)})`
                : ""}
              . This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSaving}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteBilledCost}
              disabled={deleteSaving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteSaving ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
