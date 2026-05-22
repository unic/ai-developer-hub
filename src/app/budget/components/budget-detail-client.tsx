"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createBilledCost,
  deleteBilledCost,
  updateBilledCost,
  updateBudgetAllocations,
} from "@/actions/budget";
import {
  createBudgetExtension,
  deleteBudgetExtension,
} from "@/actions/budget-extensions";
import type {
  AiTool,
  BilledCost,
  BudgetExtensionWithAllocations,
  BudgetWithCosts,
} from "@/types";
import type { RunningCostsResult } from "@/lib/budget-utils";
import { BudgetDetailHeader } from "./budget-detail-header";
import { BudgetHealthHero } from "./budget-health-hero";
import { BudgetExtensionsCard } from "./budget-extensions-card";
import { PastMonthSpotlight } from "./past-month-spotlight";
import { PeriodAllocationsTable } from "./period-allocations-table";
import {
  AddExtensionDialog,
  BilledCostDialog,
  DeleteBilledCostDialog,
  DeleteExtensionDialog,
} from "./dialogs";
import {
  makeEmptyBilledCostForm,
  type BilledCostFormState,
} from "./dialogs/billed-cost-form";
import {
  extensionFormToActionInput,
  makeEmptyExtensionForm,
  type ExtensionFormState,
} from "./dialogs/extension-form";
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
  /** Active tools available for the "Linked tool" picker in the extension dialog. */
  tools?: Pick<AiTool, "id" | "name">[];
  /** Render the breadcrumb above the title. Suppress on the canonical active-budget landing (/budget). */
  showBreadcrumb?: boolean;
}

export function BudgetDetailClient({
  budget,
  isAdmin,
  runningCosts = {},
  tools = [],
  showBreadcrumb = true,
}: Props) {
  const router = useRouter();
  const periods = budget.periods;
  const isArchived = budget.status === "archived";

  const [allocations, setAllocations] = useState<Record<number, number>>(
    Object.fromEntries(periods.map((p) => [p.id, p.plannedAmountCents]))
  );
  // Re-sync `allocations` whenever the server mutates the budget (extensions,
  // billed costs, allocation saves). Without this, an extension that bumps
  // plannedAmountCents would leave the local input state stale — the next
  // "Save allocations" click would silently write the pre-extension values
  // back. Tracked via budget.updatedAt which the server bumps on every write.
  const updatedAtKey = budget.updatedAt.toISOString();
  useEffect(() => {
    setAllocations(
      Object.fromEntries(periods.map((p) => [p.id, p.plannedAmountCents]))
    );
    // periods is intentionally read at effect-fire-time; the dep is the
    // mutation timestamp so we don't loop on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updatedAtKey]);
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

  // Budget extensions (spec 026)
  const [extensionDialogOpen, setExtensionDialogOpen] = useState(false);
  const [extensionForm, setExtensionForm] = useState<ExtensionFormState>(
    makeEmptyExtensionForm
  );
  const [extensionSaving, setExtensionSaving] = useState(false);
  const [extensionDeleteTarget, setExtensionDeleteTarget] =
    useState<BudgetExtensionWithAllocations | null>(null);
  const [extensionDeleteSaving, setExtensionDeleteSaving] = useState(false);

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

  function openExtensionDialog() {
    setExtensionForm(makeEmptyExtensionForm());
    setExtensionDialogOpen(true);
  }

  async function handleSubmitExtension() {
    const converted = extensionFormToActionInput(extensionForm, budget.id);
    if (!converted.ok) {
      toast.error(converted.error);
      return;
    }
    setExtensionSaving(true);
    const result = await createBudgetExtension(converted.input);
    setExtensionSaving(false);
    if (result.success) {
      toast.success("Extension added");
      setExtensionDialogOpen(false);
      setExtensionForm(makeEmptyExtensionForm());
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  async function handleDeleteExtension() {
    if (!extensionDeleteTarget) return;
    setExtensionDeleteSaving(true);
    const result = await deleteBudgetExtension({
      extensionId: extensionDeleteTarget.id,
    });
    setExtensionDeleteSaving(false);
    if (result.success) {
      toast.success("Extension deleted");
      setExtensionDeleteTarget(null);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="space-y-6">
      <BudgetDetailHeader
        budget={budget}
        isAdmin={isAdmin}
        showBreadcrumb={showBreadcrumb}
      />

      <BudgetHealthHero
        budget={budget}
        runningCosts={runningCosts}
        allocations={allocations}
      />

      <PastMonthSpotlight budget={budget} runningCosts={runningCosts} />

      <BudgetExtensionsCard
        extensions={budget.extensions}
        isAdmin={isAdmin}
        isArchived={isArchived}
        onAdd={openExtensionDialog}
        onDelete={(e) => setExtensionDeleteTarget(e)}
      />

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

      <AddExtensionDialog
        open={extensionDialogOpen}
        onOpenChange={setExtensionDialogOpen}
        form={extensionForm}
        onFormChange={setExtensionForm}
        budget={budget}
        tools={tools}
        onSubmit={handleSubmitExtension}
        saving={extensionSaving}
      />

      <DeleteExtensionDialog
        open={extensionDeleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setExtensionDeleteTarget(null);
        }}
        extension={extensionDeleteTarget}
        onConfirm={handleDeleteExtension}
        saving={extensionDeleteSaving}
      />
    </div>
  );
}
