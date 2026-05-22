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
import type { BilledCostFormState } from "./billed-cost-form";

type Mode = "add" | "edit";

interface Props {
  mode: Mode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: BilledCostFormState;
  onFormChange: (next: BilledCostFormState) => void;
  onSubmit: () => void;
  saving: boolean;
}

const COPY: Record<
  Mode,
  {
    title: string;
    description: string;
    submitIdle: string;
    submitBusy: string;
    amountPlaceholder: string | undefined;
    descriptionPlaceholder: string | undefined;
    vendorPlaceholder: string | undefined;
  }
> = {
  add: {
    title: "Add Billed Cost",
    description: "Record an actual billed cost for this period.",
    submitIdle: "Add Cost",
    submitBusy: "Adding...",
    amountPlaceholder: "0.00",
    descriptionPlaceholder: "e.g. GitHub Copilot Business - March invoice",
    vendorPlaceholder: "e.g. INV-2026-001",
  },
  edit: {
    title: "Edit Billed Cost",
    description: "Update the details for this billed cost entry.",
    submitIdle: "Save Changes",
    submitBusy: "Saving...",
    amountPlaceholder: undefined,
    descriptionPlaceholder: undefined,
    vendorPlaceholder: undefined,
  },
};

export function BilledCostDialog({
  mode,
  open,
  onOpenChange,
  form,
  onFormChange,
  onSubmit,
  saving,
}: Props) {
  const copy = COPY[mode];
  const idPrefix = `${mode}-billed-cost`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-amount`}>Amount ($)</Label>
            <Input
              id={`${idPrefix}-amount`}
              type="number"
              step="0.01"
              min="0.01"
              value={form.amountDollars}
              onChange={(e) =>
                onFormChange({ ...form, amountDollars: e.target.value })
              }
              placeholder={copy.amountPlaceholder}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-date`}>Invoice Date</Label>
            <Input
              id={`${idPrefix}-date`}
              type="date"
              value={form.invoiceDate}
              onChange={(e) =>
                onFormChange({ ...form, invoiceDate: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-description`}>Description</Label>
            <Input
              id={`${idPrefix}-description`}
              value={form.description}
              onChange={(e) =>
                onFormChange({ ...form, description: e.target.value })
              }
              placeholder={copy.descriptionPlaceholder}
              maxLength={500}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-vendor-ref`}>
              Vendor Reference{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id={`${idPrefix}-vendor-ref`}
              value={form.vendorReference}
              onChange={(e) =>
                onFormChange({ ...form, vendorReference: e.target.value })
              }
              placeholder={copy.vendorPlaceholder}
              maxLength={255}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={
              saving ||
              !form.amountDollars ||
              !form.description ||
              !form.invoiceDate
            }
          >
            {saving ? copy.submitBusy : copy.submitIdle}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
