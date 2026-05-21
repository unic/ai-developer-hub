"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createBilledCost,
  deleteBilledCost,
  updateBilledCost,
  updateBudgetAllocations,
} from "@/actions/budget";
import type { BilledCost, BudgetWithCosts } from "@/types";
import type { RunningCostsResult } from "@/lib/budget-utils";
import { BudgetDetailHeader } from "./budget-detail-header";
import { BudgetHealthHero } from "./budget-health-hero";
import { PastMonthSpotlight } from "./past-month-spotlight";
import { PeriodAllocationsTable } from "./period-allocations-table";
import {
  BilledCostDialog,
  DeleteBilledCostDialog,
} from "./dialogs";
import {
  makeEmptyBilledCostForm,
  type BilledCostFormState,
} from "./dialogs/billed-cost-form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface Props {
  budget: BudgetWithCosts;
  isAdmin: boolean;
  runningCosts?: Record<number, RunningCostsResult>;
  /** Render the breadcrumb above the title. Suppress on the canonical active-budget landing (/budget). */
  showBreadcrumb?: boolean;
}

export function BudgetDetailClient({
  budget,
  isAdmin,
  runningCosts = {},
  showBreadcrumb = true,
}: Props) {
  const router = useRouter();
  const periods = budget.periods;
  const isArchived = budget.status === "archived";

  const [allocations, setAllocations] = useState<Record<number, number>>(
    Object.fromEntries(periods.map((p) => [p.id, p.plannedAmountCents]))
  );
  const [saving, setSaving] = useState(false);

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addPeriodId, setAddPeriodId] = useState<number | null>(null);
  const [addForm, setAddForm] = useState<BilledCostFormState>(
    makeEmptyBilledCostForm
  );
  const [addSaving, setAddSaving] = useState(false);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<BilledCost | null>(null);
  const [editForm, setEditForm] = useState<BilledCostFormState>(
    makeEmptyBilledCostForm
  );
  const [editSaving, setEditSaving] = useState(false);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteEntry, setDeleteEntry] = useState<BilledCost | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);

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

  function openAddDialog(periodId: number) {
    setAddPeriodId(periodId);
    setAddForm(makeEmptyBilledCostForm());
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

  function handleAllocationChange(periodId: number, cents: number) {
    setAllocations((prev) =>
      prev[periodId] === cents ? prev : { ...prev, [periodId]: cents }
    );
  }

  return (
    <div className="space-y-6">
      <BudgetDetailHeader
        budget={budget}
        isAdmin={isAdmin}
        showBreadcrumb={showBreadcrumb}
      />

      <BudgetHealthHero budget={budget} runningCosts={runningCosts} />

      <PastMonthSpotlight budget={budget} runningCosts={runningCosts} />

      <Card>
        <CardHeader>
          <CardTitle>Period allocations &amp; billed costs</CardTitle>
        </CardHeader>
        <CardContent>
          <PeriodAllocationsTable
            budget={budget}
            runningCosts={runningCosts}
            allocations={allocations}
            onAllocationChange={handleAllocationChange}
            isAdmin={isAdmin}
            isArchived={isArchived}
            saving={saving}
            onSaveAllocations={handleSave}
            onAddBilledCost={openAddDialog}
            onEditBilledCost={openEditDialog}
            onDeleteBilledCost={openDeleteDialog}
          />
        </CardContent>
      </Card>

      <BilledCostDialog
        mode="add"
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        form={addForm}
        onFormChange={setAddForm}
        onSubmit={handleAddBilledCost}
        saving={addSaving}
      />

      <BilledCostDialog
        mode="edit"
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        form={editForm}
        onFormChange={setEditForm}
        onSubmit={handleEditBilledCost}
        saving={editSaving}
      />

      <DeleteBilledCostDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        entry={deleteEntry}
        onConfirm={handleDeleteBilledCost}
        saving={deleteSaving}
      />
    </div>
  );
}
