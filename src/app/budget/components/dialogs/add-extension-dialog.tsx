"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  StatusText,
  type InlineStatusState,
} from "@/components/ui/status-text";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import type { AiTool, BudgetWithCosts } from "@/types";
import {
  CATEGORY_OPTIONS,
  parseExtensionCents,
  previewDistributeRemaining,
  type AllocationMode,
  type ExtensionFormState,
} from "./extension-form";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: ExtensionFormState;
  onFormChange: (next: ExtensionFormState) => void;
  budget: BudgetWithCosts;
  tools: Pick<AiTool, "id" | "name">[];
  onSubmit: () => void;
  saving: boolean;
  /** Inline submit feedback — rendered in the footer (no toasts in the Nothing system). */
  status?: InlineStatusState;
}

const ALLOCATION_OPTIONS: {
  value: AllocationMode;
  label: string;
  description: string;
}[] = [
  {
    value: "distribute_remaining",
    label: "Distribute across remaining periods",
    description:
      "Split the amount evenly across periods that haven't ended yet.",
  },
  {
    value: "single_period",
    label: "Add to a single period",
    description: "Useful for one-off costs (e.g. an annual license).",
  },
  {
    value: "unallocated",
    label: "Leave unallocated",
    description: "Raises the ceiling only; allocate manually later.",
  },
];

// Special select sentinel for "no linked tool" — Radix Select forbids `value=""`.
const NO_LINKED_TOOL = "__none__";

export function AddExtensionDialog({
  open,
  onOpenChange,
  form,
  onFormChange,
  budget,
  tools,
  onSubmit,
  saving,
  status,
}: Props) {
  const set = <K extends keyof ExtensionFormState>(
    key: K,
    value: ExtensionFormState[K]
  ) => onFormChange({ ...form, [key]: value });

  // Live preview uses the same parsing as the submit path (parseExtensionCents)
  // so the preview can never accept a value the server will reject.
  const parsedPreview = parseExtensionCents(form);
  const signedCents = parsedPreview.ok ? parsedPreview.cents : 0;
  const nextCeiling = budget.totalAmountCents + signedCents;
  const currentAllocations = budget.periods.reduce(
    (s, p) => s + p.plannedAmountCents,
    0
  );

  // Mirror the server's distribute_remaining math (resolveAllocations) so the
  // preview blurb reflects the actual per-period write — including the remainder
  // dumped onto the first period when the amount doesn't divide evenly.
  const remainingPeriods = budget.periods.filter(
    (p) => p.endDate >= form.effectiveDate
  );
  const distributeTargets =
    remainingPeriods.length > 0 ? remainingPeriods : budget.periods;
  const distributeTargetCount = distributeTargets.length;
  const dist =
    form.allocationMode === "distribute_remaining" && signedCents !== 0
      ? previewDistributeRemaining(signedCents, distributeTargetCount)
      : null;

  const submitDisabled =
    saving ||
    !form.reason.trim() ||
    !form.amountDollars ||
    !form.effectiveDate ||
    (form.allocationMode === "single_period" && !form.singlePeriodId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add budget extension</DialogTitle>
          <DialogDescription>
            Record a change to the annual ceiling. Use a negative (reduction) for
            unwinding a prior bump.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ext-reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Input
              id="ext-reason"
              value={form.reason}
              onChange={(e) => set("reason", e.target.value)}
              maxLength={120}
              placeholder="e.g. Add Claude API for engineering team"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ext-amount">
                Amount ($) <span className="text-destructive">*</span>
              </Label>
              <div className="flex gap-2">
                <Select
                  value={form.sign}
                  onValueChange={(v) => set("sign", v as "+" | "-")}
                >
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="+">+ add</SelectItem>
                    <SelectItem value="-">− reduce</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  id="ext-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={form.amountDollars}
                  onChange={(e) => set("amountDollars", e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ext-date">
                Effective date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ext-date"
                type="date"
                value={form.effectiveDate}
                onChange={(e) => set("effectiveDate", e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ext-category">
                Category <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.category}
                onValueChange={(v) =>
                  set("category", v as ExtensionFormState["category"])
                }
              >
                <SelectTrigger id="ext-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ext-tool">
                Linked tool{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Select
                value={form.linkedToolId || NO_LINKED_TOOL}
                onValueChange={(v) =>
                  set("linkedToolId", v === NO_LINKED_TOOL ? "" : v)
                }
              >
                <SelectTrigger id="ext-tool">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LINKED_TOOL}>None</SelectItem>
                  {tools.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ext-description">
              Description{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="ext-description"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Why is the budget moving? Approval reference, etc."
            />
          </div>

          <div className="space-y-2">
            <Label>Allocate to periods</Label>
            <div className="space-y-2">
              {ALLOCATION_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 p-3 border rounded-md cursor-pointer transition-colors ${
                    form.allocationMode === opt.value
                      ? "border-ink"
                      : "border-border hover:bg-accent/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="ext-allocation"
                    className="mt-1"
                    checked={form.allocationMode === opt.value}
                    onChange={() => set("allocationMode", opt.value)}
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{opt.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {opt.description}
                      {opt.value === "distribute_remaining" && dist && (
                        <>
                          {" "}
                          (
                          {dist.remainder === 0
                            ? `${distributeTargetCount} periods × ${formatCurrency(dist.perPeriod)}`
                            : `${distributeTargetCount - 1} × ${formatCurrency(dist.perPeriod)} + ${formatCurrency(dist.firstPeriod)} to the first period`}
                          )
                        </>
                      )}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            {form.allocationMode === "single_period" && (
              <div className="space-y-2 pl-3 border-l-2 border-border ml-2">
                <Label htmlFor="ext-period">Period</Label>
                <Select
                  value={form.singlePeriodId}
                  onValueChange={(v) => set("singlePeriodId", v)}
                >
                  <SelectTrigger id="ext-period">
                    <SelectValue placeholder="Pick a period" />
                  </SelectTrigger>
                  <SelectContent>
                    {budget.periods.map((p) => {
                      // Periods whose endDate < today are already closed —
                      // bumping their planned amount muddies billed-vs-planned
                      // variance after the fact. Mark them disabled with a
                      // hint so the option is still visible (useful for
                      // backfill scenarios) but discouraged.
                      const closed =
                        p.endDate < new Date().toISOString().slice(0, 10);
                      return (
                        <SelectItem
                          key={p.id}
                          value={String(p.id)}
                          disabled={closed}
                        >
                          {p.periodLabel}
                          {closed && (
                            <span className="text-muted-foreground ml-2 text-xs">
                              (closed)
                            </span>
                          )}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {signedCents !== 0 && (
            <div className="rounded-md border border-input p-3 text-sm space-y-1">
              <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                Effect on FY {budget.fiscalYear} budget
              </div>
              <div className="flex justify-between tabular-nums">
                <span className="text-muted-foreground">Annual ceiling</span>
                <span>
                  <span className="text-muted-foreground">
                    {formatCurrency(budget.totalAmountCents)}
                  </span>{" "}
                  →{" "}
                  <span className="font-medium text-ink">
                    {formatCurrency(nextCeiling)}
                  </span>
                </span>
              </div>
              <div className="flex justify-between tabular-nums">
                <span className="text-muted-foreground">
                  Allocations after change
                </span>
                <span className="font-medium text-ink">
                  {formatCurrency(
                    currentAllocations +
                      (form.allocationMode === "unallocated" ? 0 : signedCents)
                  )}
                </span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {status && <StatusText status={status} className="sm:mr-auto" />}
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={submitDisabled}>
            {saving ? "Saving..." : "Add extension"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
