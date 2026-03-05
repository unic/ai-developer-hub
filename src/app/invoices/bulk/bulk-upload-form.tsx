"use client";

import { useState, useRef, useMemo } from "react";
import { toast } from "sonner";
import { Loader2, Upload, ArrowLeft } from "lucide-react";
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
import { saveBulkInvoices, type BulkSaveOutcome } from "@/actions/invoices";
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
  amountCents: string;
  vendor: string;
  confidence: {
    invoiceNumber: "high" | "medium" | "low";
    invoiceDate: "high" | "medium" | "low";
    amountCents: "high" | "medium" | "low";
    vendor: "high" | "medium" | "low";
  } | null;
  error: string | null;
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
    amountCents: d.extracted?.amountCents != null ? String(d.extracted.amountCents) : "",
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
  function updateRow(index: number, field: "invoiceNumber" | "invoiceDate" | "amountCents" | "vendor", value: string) {
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  const columns: ColumnDef<EditableRow, unknown>[] = useMemo(() => [
    {
      accessorKey: "filename",
      header: "Filename",
      cell: ({ row }) => (
        <span className="font-mono text-sm">{row.original.filename}</span>
      ),
    },
    {
      accessorKey: "invoiceNumber",
      header: "Invoice Number",
      cell: ({ row }) => {
        const lowConf = row.original.confidence?.invoiceNumber === "low";
        return (
          <Input
            value={row.original.invoiceNumber}
            onChange={(e) => updateRow(row.index, "invoiceNumber", e.target.value)}
            className={cn(lowConf && "border-amber-500")}
            aria-label={`Invoice number for ${row.original.filename}`}
          />
        );
      },
    },
    {
      accessorKey: "invoiceDate",
      header: "Date",
      cell: ({ row }) => {
        const lowConf = row.original.confidence?.invoiceDate === "low";
        return (
          <Input
            value={row.original.invoiceDate}
            onChange={(e) => updateRow(row.index, "invoiceDate", e.target.value)}
            className={cn(lowConf && "border-amber-500")}
            aria-label={`Invoice date for ${row.original.filename}`}
          />
        );
      },
    },
    {
      accessorKey: "amountCents",
      header: "Amount",
      cell: ({ row }) => {
        const lowConf = row.original.confidence?.amountCents === "low";
        return (
          <Input
            type="number"
            value={row.original.amountCents}
            onChange={(e) => updateRow(row.index, "amountCents", e.target.value)}
            className={cn(lowConf && "border-amber-500")}
            aria-label={`Amount in cents for ${row.original.filename}`}
          />
        );
      },
    },
    {
      accessorKey: "vendor",
      header: "Vendor",
      cell: ({ row }) => {
        const conf = row.original.confidence?.vendor;
        const lowOrNull = conf === "low" || conf === null;
        return (
          <Input
            value={row.original.vendor}
            onChange={(e) => updateRow(row.index, "vendor", e.target.value)}
            className={cn(lowOrNull && "border-amber-500")}
            aria-label={`Vendor for ${row.original.filename}`}
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
  ], []);

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
      setRows(draftsToRows(drafts));
      setState("reviewing");
      const skippedMsg = skipped.length > 0 ? ` (${skipped.length} non-PDF files skipped)` : "";
      toast.success(`Extracted ${drafts.length} invoice(s). Please review.${skippedMsg}`);
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
      const incomplete = rows.filter((r) => !r.invoiceNumber || !r.invoiceDate || !r.amountCents);
      if (incomplete.length > 0) {
        toast.error(`${incomplete.length} row(s) have missing required fields.`);
        setState("reviewing");
        return;
      }

      const payload = rows.map((r) => ({
        filename: r.filename,
        invoiceNumber: r.invoiceNumber,
        invoiceDate: r.invoiceDate,
        amountCents: Number(r.amountCents),
        vendor: r.vendor || undefined,
        blobUrl: r.blobUrl,
        blobPathname: r.objectKey,
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

  return (
    <div className="space-y-6">
      {/* ARIA live region for state announcements */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
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
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="text-center">
                      No invoices extracted.
                    </TableCell>
                  </TableRow>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
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
                {outcomes.map((outcome, i) => (
                  <TableRow key={i}>
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
                      {outcome.error ? (
                        <Badge variant="destructive">{outcome.error}</Badge>
                      ) : (
                        <Badge variant="default">Saved</Badge>
                      )}
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
