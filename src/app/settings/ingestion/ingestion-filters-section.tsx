"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createIngestionFilter,
  updateIngestionFilter,
  deleteIngestionFilter,
  toggleIngestionFilter,
} from "@/actions/ingestion-filters";
import type { IngestionFilterRow } from "@/actions/ingestion-filters";

interface IngestionFiltersSectionProps {
  filters: IngestionFilterRow[];
}

type FormState = {
  name: string;
  field: "vendor" | "invoice_number";
  mode: "whitelist" | "blacklist";
  vendorValues: string;
  pattern: string;
  priority: string;
};

const defaultForm: FormState = {
  name: "",
  field: "vendor",
  mode: "blacklist",
  vendorValues: "",
  pattern: "",
  priority: "0",
};

function formFromRow(row: IngestionFilterRow): FormState {
  const val = row.value;
  return {
    name: row.name,
    field: row.field,
    mode: row.mode,
    vendorValues:
      row.field === "vendor" && "values" in val
        ? (val.values as string[]).join(", ")
        : "",
    pattern:
      row.field === "invoice_number" && "pattern" in val
        ? (val.pattern as string)
        : "",
    priority: String(row.priority),
  };
}

function buildValue(form: FormState) {
  if (form.field === "vendor") {
    return {
      values: form.vendorValues
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    };
  }
  return { pattern: form.pattern };
}

export function IngestionFiltersSection({
  filters,
}: IngestionFiltersSectionProps) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [isPending, startTransition] = useTransition();
  const [patternError, setPatternError] = useState<string | null>(null);

  function openCreate() {
    setEditingId(null);
    setForm(defaultForm);
    setPatternError(null);
    setDialogOpen(true);
  }

  function openEdit(row: IngestionFilterRow) {
    setEditingId(row.id);
    setForm(formFromRow(row));
    setPatternError(null);
    setDialogOpen(true);
  }

  function validatePattern(val: string): boolean {
    try {
      new RegExp(val);
      setPatternError(null);
      return true;
    } catch {
      setPatternError("Invalid regular expression");
      return false;
    }
  }

  function handleSave() {
    if (form.field === "invoice_number" && !validatePattern(form.pattern)) {
      return;
    }

    const value = buildValue(form);
    const priority = Number.parseInt(form.priority, 10) || 0;

    startTransition(async () => {
      const result = editingId
        ? await updateIngestionFilter({
            id: editingId,
            name: form.name,
            field: form.field,
            mode: form.mode,
            value,
            priority,
          })
        : await createIngestionFilter({
            name: form.name,
            field: form.field,
            mode: form.mode,
            value,
            priority,
          });

      if (result.success) {
        toast.success(editingId ? "Filter updated" : "Filter created");
        setDialogOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleToggle(id: number) {
    startTransition(async () => {
      const result = await toggleIngestionFilter(id);
      if (result.success) {
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDelete(id: number, name: string) {
    if (!confirm(`Delete filter "${name}"? Previously filtered invoices will remain unchanged.`)) {
      return;
    }
    startTransition(async () => {
      const result = await deleteIngestionFilter(id);
      if (result.success) {
        toast.success("Filter deleted");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Filters</h3>
          <p className="text-sm text-muted-foreground">
            Rules that control which invoices are linked to budget periods.
          </p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="mr-2 size-4" />
          New Filter
        </Button>
      </div>

      {filters.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed p-8 text-center">
          <Filter className="mb-3 size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No filter rules configured. All invoices will be linked to budget
            periods.
          </p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Field</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Value</TableHead>
                <TableHead className="w-20 text-center">Priority</TableHead>
                <TableHead className="w-20 text-center">Enabled</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filters.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">{f.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {f.field === "vendor" ? "Vendor" : "Invoice #"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        f.mode === "blacklist" ? "destructive" : "default"
                      }
                    >
                      {f.mode === "blacklist" ? "Blacklist" : "Whitelist"}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                    {f.field === "vendor" && "values" in f.value
                      ? (f.value.values as string[]).join(", ")
                      : "pattern" in f.value
                        ? (f.value.pattern as string)
                        : "—"}
                  </TableCell>
                  <TableCell className="text-center">{f.priority}</TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={f.enabled}
                      onCheckedChange={() => handleToggle(f.id)}
                      disabled={isPending}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => openEdit(f)}
                        disabled={isPending}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive"
                        onClick={() => handleDelete(f.id, f.name)}
                        disabled={isPending}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Filter" : "New Filter Rule"}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? "Update this filter rule. Changes apply to future ingestions only."
                : "Create a rule to control which invoices are linked to budget periods."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="filter-name">Name</Label>
              <Input
                id="filter-name"
                placeholder="e.g., Block Office Supplies"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            {!editingId && (
              <div className="space-y-2">
                <Label htmlFor="filter-field">Field</Label>
                <Select
                  value={form.field}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      field: v as "vendor" | "invoice_number",
                    })
                  }
                >
                  <SelectTrigger id="filter-field">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vendor">Vendor</SelectItem>
                    <SelectItem value="invoice_number">
                      Invoice Number
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="filter-mode">Mode</Label>
              <Select
                value={form.mode}
                onValueChange={(v) =>
                  setForm({ ...form, mode: v as "whitelist" | "blacklist" })
                }
              >
                <SelectTrigger id="filter-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="blacklist">
                    Blacklist — matching invoices excluded from budget
                  </SelectItem>
                  <SelectItem value="whitelist">
                    Whitelist — only matching invoices are budget-linked
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.field === "vendor" ? (
              <div className="space-y-2">
                <Label htmlFor="filter-vendor-values">
                  Vendor names (comma-separated)
                </Label>
                <Input
                  id="filter-vendor-values"
                  placeholder="e.g., Office Supplies Co, Staples"
                  value={form.vendorValues}
                  onChange={(e) =>
                    setForm({ ...form, vendorValues: e.target.value })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Case-insensitive substring matching. &quot;office&quot; matches
                  &quot;Office Supplies Co&quot;.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="filter-pattern">Regex pattern</Label>
                <Input
                  id="filter-pattern"
                  placeholder="e.g., ^TEST- or INTERNAL"
                  value={form.pattern}
                  onChange={(e) => {
                    setForm({ ...form, pattern: e.target.value });
                    if (e.target.value) validatePattern(e.target.value);
                    else setPatternError(null);
                  }}
                />
                {patternError && (
                  <p className="text-xs text-destructive">{patternError}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Case-insensitive regex tested against the invoice number.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="filter-priority">Priority (lower = first)</Label>
              <Input
                id="filter-priority"
                type="number"
                min={0}
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isPending || !form.name.trim()}
            >
              {isPending ? "Saving..." : editingId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
