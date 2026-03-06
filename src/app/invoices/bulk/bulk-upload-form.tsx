"use client";

import { useState, useRef, useMemo } from "react";
import { toast } from "sonner";
import { Loader2, Upload, ArrowLeft, AlertTriangle } from "lucide-react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Link from "next/link";
import {
  saveBulkInvoices,
  checkBulkDuplicates,
  type BulkSaveOutcome,
} from "@/actions/invoices";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExtractionDraft = {
  filename: string;
  objectKey: string;
  blobUrl: string;
  extracted: {
    invoiceNumber: string | null;
    invoiceDate: string | null;
    amountCents: number | null;
    vendor: string | null;
    confidence: {
      invoiceNumber: "high" | "medium" | "low";
      invoiceDate: "high" | "medium" | "low";
      amountCents: "high" | "medium" | "low";
      vendor: "high" | "medium" | "low";
    };
  } | null;
  error: string | null;
};

type EditableRow = {
  filename: string;
  objectKey: string;
  blobUrl: string;
  invoiceNumber: string;
  invoiceDate: string;
  amountDollars: string;
  vendor: string;
  confidence: {
    invoiceNumber: "high" | "medium" | "low";
    invoiceDate: "high" | "medium" | "low";
    amountCents: "high" | "medium" | "low";
    vendor: "high" | "medium" | "low";
  } | null;
  error: string | null;
  duplicateType?: "db-duplicate" | "within-batch-duplicate";
};

type State = "idle" | "uploading" | "reviewing" | "saving" | "done" | "error";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function draftsToRows(drafts: ExtractionDraft[]): EditableRow[] {
  return drafts.map((d) => ({
    filename: d.filename,
    objectKey: d.objectKey,
    blobUrl: d.blobUrl,
    invoiceNumber: d.extracted?.invoiceNumber ?? "",
    invoiceDate: d.extracted?.invoiceDate ?? "",
    amountDollars:
      d.extracted?.amountCents != null
        ? (d.extracted.amountCents / 100).toFixed(2)
        : "",
    vendor: d.extracted?.vendor ?? "",
    confidence: d.extracted?.confidence ?? null,
    error: d.error,
  }));
}

function stateLabel(state: State): string {
  switch (state) {
    case "idle":
      return "Ready to upload a ZIP file.";
    case "uploading":
      return "Uploading and extracting invoices...";
    case "reviewing":
      return "Review extracted invoices before saving.";
    case "saving":
      return "Saving invoices...";
    case "done":
      return "Bulk upload complete.";
    case "error":
      return "An error occurred during bulk upload.";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BulkUploadForm() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>("idle");
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [outcomes, setOutcomes] = useState<BulkSaveOutcome[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ---- row mutation helper ----
  function updateRow(
    index: number,
    field: "invoiceNumber" | "invoiceDate" | "amountDollars" | "vendor",
    value: string,
  ) {
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  const columns: ColumnDef<EditableRow, unknown>[] = useMemo(
    () => [
      {
        accessorKey: "filename",
        header: "Filename",
        cell: ({ row }) => (
          <span className="font-mono text-sm">{row.original.filename}</span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          const dup = row.original.duplicateType;
          if (dup === "db-duplicate") {
            return (
              <Badge variant="outline" className="text-amber-600">
                <AlertTriangle className="mr-1 size-3" />
                Duplicate — will be skipped
              </Badge>
            );
          }
          if (dup === "within-batch-duplicate") {
            return (
              <Badge variant="outline" className="text-amber-600">
                <AlertTriangle className="mr-1 size-3" />
                Within-batch duplicate — will be skipped
              </Badge>
            );
          }
          return null;
        },
      },
      {
        accessorKey: "invoiceNumber",
        header: "Invoice Number",
        cell: ({ row }) => {
          const lowConf = row.original.confidence?.invoiceNumber === "low";
          const isDuplicate = !!row.original.duplicateType;
          return (
            <Input
              value={row.original.invoiceNumber}
              onChange={(e) =>
                updateRow(row.index, "invoiceNumber", e.target.value)
              }
              className={cn(lowConf && "border-amber-500")}
              aria-label={`Invoice number for ${row.original.filename}`}
              disabled={isDuplicate}
            />
          );
        },
      },
      {
        accessorKey: "invoiceDate",
        header: "Date",
        cell: ({ row }) => {
          const lowConf = row.original.confidence?.invoiceDate === "low";
          const isDuplicate = !!row.original.duplicateType;
          return (
            <Input
              value={row.original.invoiceDate}
              onChange={(e) =>
                updateRow(row.index, "invoiceDate", e.target.value)
              }
              className={cn(lowConf && "border-amber-500")}
              aria-label={`Invoice date for ${row.original.filename}`}
              disabled={isDuplicate}
            />
          );
        },
      },
      {
        accessorKey: "amountDollars",
        header: "Amount",
        cell: ({ row }) => {
          const lowConf = row.original.confidence?.amountCents === "low";
          const isDuplicate = !!row.original.duplicateType;
          return (
            <Input
              type="number"
              step="0.01"
              value={row.original.amountDollars}
              onChange={(e) =>
                updateRow(row.index, "amountDollars", e.target.value)
              }
              className={cn(lowConf && "border-amber-500")}
              aria-label={`Amount in dollars for ${row.original.filename}`}
              disabled={isDuplicate}
            />
          );
        },
      },
      {
        accessorKey: "vendor",
        header: "Vendor",
        cell: ({ row }) => {
          const conf = row.original.confidence?.vendor;
          const lowOrNull = conf === "low" || conf == null;
          const isDuplicate = !!row.original.duplicateType;
          return (
            <Input
              value={row.original.vendor}
              onChange={(e) => updateRow(row.index, "vendor", e.target.value)}
              className={cn(lowOrNull && "border-amber-500")}
              aria-label={`Vendor for ${row.original.filename}`}
              disabled={isDuplicate}
            />
          );
        },
      },
      {
        accessorKey: "error",
        header: "Error",
        cell: ({ row }) =>
          row.original.error ? (
            <Badge variant="destructive">{row.original.error}</Badge>
          ) : null,
      },
    ],
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  // ---- upload handler ----
  async function handleUpload(file: File) {
    if (file.size > MAX_FILE_SIZE) {
      toast.error("File too large. Maximum size is 50 MB.");
      return;
    }

    setState("uploading");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/invoices/bulk-upload", {
        method: "POST",
        headers: { "Content-Type": "application/zip" },
        body: file,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(body.error ?? `Upload failed (${res.status})`);
      }

      const { results: drafts, skipped } = (await res.json()) as {
        results: ExtractionDraft[];
        skipped: string[];
      };

      const editableRows = draftsToRows(drafts);

      // --- T011: Check for DB duplicates ---
      const invoiceNumbers = editableRows
        .map((r) => r.invoiceNumber)
        .filter(Boolean);

      let dbDuplicates: Record<string, unknown> = {};
      if (invoiceNumbers.length > 0) {
        const dupResult = await checkBulkDuplicates(invoiceNumbers);
        if (dupResult.success) {
          dbDuplicates = dupResult.data.duplicates;
        }
      }

      // --- T012: Within-batch duplicate detection ---
      const seen = new Set<string>();
      const batchDuplicates = new Set<number>();
      for (let i = 0; i < editableRows.length; i++) {
        const num = editableRows[i].invoiceNumber;
        if (!num) continue;
        if (seen.has(num)) {
          batchDuplicates.add(i);
        } else {
          seen.add(num);
        }
      }

      // Apply duplicate flags to rows
      const flaggedRows = editableRows.map((row, i) => {
        if (row.invoiceNumber && row.invoiceNumber in dbDuplicates) {
          return { ...row, duplicateType: "db-duplicate" as const };
        }
        if (batchDuplicates.has(i)) {
          return {
            ...row,
            duplicateType: "within-batch-duplicate" as const,
          };
        }
        return row;
      });

      setRows(flaggedRows);
      setState("reviewing");
      const skippedMsg =
        skipped.length > 0
          ? ` (${skipped.length} non-PDF files skipped)`
          : "";
      toast.success(
        `Extracted ${drafts.length} invoice(s). Please review.${skippedMsg}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setErrorMessage(message);
      setState("error");
      toast.error(message);
    }
  }

  // ---- save handler ----
  async function handleSave() {
    setState("saving");
    setErrorMessage(null);

    try {
      // Only validate non-skipped rows for completeness
      const incomplete = rows.filter(
        (r) =>
          !r.duplicateType &&
          (!r.invoiceNumber || !r.invoiceDate || !r.amountDollars),
      );
      if (incomplete.length > 0) {
        toast.error(
          `${incomplete.length} row(s) have missing required fields.`,
        );
        setState("reviewing");
        return;
      }

      const payload = rows.map((r) => ({
        filename: r.filename,
        invoiceNumber: r.invoiceNumber,
        invoiceDate: r.invoiceDate,
        amountCents: Math.round(parseFloat(r.amountDollars) * 100),
        vendor: r.vendor || undefined,
        blobUrl: r.blobUrl,
        blobPathname: r.objectKey,
        ...(r.duplicateType
          ? { skip: true as const, skipReason: r.duplicateType }
          : {}),
      }));

      const result = await saveBulkInvoices(payload);

      if (!result.success) {
        throw new Error(result.error);
      }

      setOutcomes(result.data);
      setState("done");
      toast.success("Invoices saved successfully.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      setErrorMessage(message);
      setState("error");
      toast.error(message);
    }
  }

  // ---- outcome summary helpers ----
  const savedOutcomes = outcomes.filter(
    (o) => !o.error && !o.skipped,
  );
  const skippedOutcomes = outcomes.filter((o) => o.skipped);
  const failedOutcomes = outcomes.filter((o) => !!o.error);

  return (
    <div className="space-y-6">
      {/* ARIA live region for state announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {stateLabel(state)}
      </div>

      {/* ---- IDLE ---- */}
      {state === "idle" && (
        <div className="flex items-center gap-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/zip,.zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
            }}
          />
          <Button
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mr-2 size-4" />
            Upload Zip
          </Button>
        </div>
      )}

      {/* ---- UPLOADING ---- */}
      {state === "uploading" && (
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span>Uploading and extracting invoices...</span>
        </div>
      )}

      {/* ---- REVIEWING ---- */}
      {state === "reviewing" && (
        <div className="space-y-4">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="text-center"
                    >
                      No invoices extracted.
                    </TableCell>
                  </TableRow>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className={cn(
                        row.original.duplicateType && "opacity-50",
                      )}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <Button onClick={handleSave}>Save All</Button>
        </div>
      )}

      {/* ---- SAVING ---- */}
      {state === "saving" && (
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span>Saving invoices...</span>
        </div>
      )}

      {/* ---- DONE ---- */}
      {state === "done" && (
        <div className="space-y-4">
          {/* Outcome summary counts */}
          <div className="flex flex-wrap gap-4">
            <Badge variant="default">
              {savedOutcomes.length} invoice(s) saved
            </Badge>
            {skippedOutcomes.length > 0 && (
              <Badge variant="outline" className="text-amber-600">
                {skippedOutcomes.length} invoice(s) skipped (duplicate)
              </Badge>
            )}
            {failedOutcomes.length > 0 && (
              <Badge variant="destructive">
                {failedOutcomes.length} invoice(s) failed
              </Badge>
            )}
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Filename</TableHead>
                  <TableHead>Invoice ID</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Saved outcomes */}
                {savedOutcomes.map((outcome, i) => (
                  <TableRow key={`saved-${i}`}>
                    <TableCell className="font-mono text-sm">
                      {outcome.filename}
                    </TableCell>
                    <TableCell>{outcome.invoiceId ?? "—"}</TableCell>
                    <TableCell>
                      {outcome.linkedPeriodLabel ? (
                        outcome.linkedPeriodLabel
                      ) : outcome.linkWarning ? (
                        <Badge variant="outline">No matching period</Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="default">Saved</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {/* Skipped outcomes */}
                {skippedOutcomes.map((outcome, i) => (
                  <TableRow key={`skipped-${i}`} className="opacity-50">
                    <TableCell className="font-mono text-sm">
                      {outcome.filename}
                    </TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-amber-600">
                        <AlertTriangle className="mr-1 size-3" />
                        Skipped — {outcome.skipReason === "within-batch-duplicate"
                          ? "within-batch duplicate"
                          : "duplicate"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {/* Failed outcomes */}
                {failedOutcomes.map((outcome, i) => (
                  <TableRow key={`failed-${i}`}>
                    <TableCell className="font-mono text-sm">
                      {outcome.filename}
                    </TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>
                      <Badge variant="destructive">{outcome.error}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <Button variant="outline" asChild>
            <Link href="/invoices">
              <ArrowLeft className="mr-2 size-4" />
              Back to Invoices
            </Link>
          </Button>
        </div>
      )}

      {/* ---- ERROR ---- */}
      {state === "error" && (
        <div className="space-y-4">
          <p className="text-destructive">{errorMessage}</p>
          <Button
            variant="outline"
            onClick={() => {
              setState("idle");
              setErrorMessage(null);
            }}
          >
            Try Again
          </Button>
        </div>
      )}
    </div>
  );
}
