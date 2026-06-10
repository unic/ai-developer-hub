"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
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
  const allocStatus = useInlineStatus();
  const billedStatus = useInlineStatus();
  const deleteStatus = useInlineStatus();
  const periods = budget.periods;
  const isArchived = budget.status === "archived";

  const [allocations, setAllocations] = useState<Record<number, number>>(
    Object.fromEntries(periods.map((p) => [p.id, p.plannedAmountCents]))
  );
  // Re-sync `allocations` whenever the server reports new period planned
  // amounts. Without this, an extension that bumps plannedAmountCents (via
  // createBudgetExtension) would leave the local input state stale, and the
  // next "Save allocations" click would silently write the pre-extension
  // values back.
  //
  // The trigger is the per-period planned values themselves, not
  // budget.updatedAt — only extension create/delete, archiveBudget, and
  // updateBudgetTotal bump annual_budgets.updated_at, while
  // updateBudgetAllocations and billed-cost CRUD do not. Hashing the period
  // values catches every case where the server-side planned amount changed,
  // including future actions that don't touch annual_budgets.
  const periodsKey = periods
    .map((p) => `${p.id}:${p.plannedAmountCents}`)
    .join("|");
  useEffect(() => {
    setAllocations(
      Object.fromEntries(periods.map((p) => [p.id, p.plannedAmountCents]))
    );
    // `periods` is intentionally re-read at effect-fire-time; the dep is the
    // value-hash so unrelated re-renders don't cause loops or blow away
    // unsaved local edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodsKey]);
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
      allocStatus.ok("Saved");
      router.refresh();
    } else {
      allocStatus.error(result.error);
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
      billedStatus.error("Invalid amount");
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
      setAddDialogOpen(false);
      router.refresh();
    } else {
      billedStatus.error(result.error);
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
      billedStatus.error("Invalid amount");
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
      setEditDialogOpen(false);
      router.refresh();
    } else {
      billedStatus.error(result.error);
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
      setDeleteDialogOpen(false);
      router.refresh();
    } else {
      deleteStatus.error(result.error);
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
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Period allocations &amp; billed costs</CardTitle>
            <StatusText status={allocStatus.status} />
          </div>
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

      <div className="flex items-center justify-end gap-4">
        <StatusText status={billedStatus.status} />
        <StatusText status={deleteStatus.status} />
      </div>

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
