"use client";

import { ColumnDef } from "@tanstack/react-table";
import { DataTable, arrayIncludesFilterFn } from "@/components/data-table";
import { DataTableColumnHeader } from "@/components/data-table-column-header";
import { ErrorPopover } from "@/components/error-popover";
import { OutcomeBadge } from "@/components/outcome-badge";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { IngestionLogRow } from "@/actions/ingestion-log";

const columns: ColumnDef<IngestionLogRow>[] = [
  {
    accessorKey: "outcome",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => (
      <OutcomeBadge outcome={row.getValue("outcome")} nullLabel="Unknown" />
    ),
    filterFn: arrayIncludesFilterFn,
  },
  {
    accessorKey: "invoiceNumber",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Document ID" />
    ),
    cell: ({ row }) => (
      <span className="font-medium">
        {row.getValue("invoiceNumber") ?? (
          <span className="text-muted-foreground">-</span>
        )}
      </span>
    ),
  },
  {
    accessorKey: "vendor",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Vendor" />
    ),
    cell: ({ row }) => row.getValue("vendor") ?? "Unknown",
    filterFn: arrayIncludesFilterFn,
  },
  {
    accessorKey: "invoiceDate",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Date" />
    ),
    cell: ({ row }) => {
      const val = row.getValue("invoiceDate") as string | null;
      return val ?? <span className="text-muted-foreground">-</span>;
    },
  },
  {
    accessorKey: "amountCents",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Amount" />
    ),
    cell: ({ row }) => {
      const cents = row.getValue("amountCents") as number | null;
      return cents != null ? (
        formatCurrency(cents)
      ) : (
        <span className="text-muted-foreground">-</span>
      );
    },
  },
  {
    accessorKey: "channel",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Channel" />
    ),
    cell: ({ row }) => {
      const channel = row.getValue("channel") as string;
      return channel.charAt(0).toUpperCase() + channel.slice(1);
    },
  },
  {
    accessorKey: "uploaderName",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Uploaded By" />
    ),
    cell: ({ row }) => row.getValue("uploaderName") ?? "API",
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Ingested At" />
    ),
    cell: ({ row }) => formatDateTime(row.getValue("createdAt")),
  },
  {
    accessorKey: "errorMessage",
    header: "Error",
    cell: ({ row }) => (
      <ErrorPopover errorMessage={row.getValue("errorMessage")} />
    ),
    enableSorting: false,
  },
  {
    id: "download",
    header: "",
    cell: ({ row }) => {
      const linkedInvoiceId = row.original.linkedInvoiceId;
      if (!linkedInvoiceId) {
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" disabled className="size-8">
                <Download className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>No document available</TooltipContent>
          </Tooltip>
        );
      }
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" asChild>
              <a
                href={`/api/invoices/${linkedInvoiceId}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Download className="size-4" />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Download document</TooltipContent>
        </Tooltip>
      );
    },
    enableSorting: false,
  },
];

interface IngestionHistoryTableProps {
  data: IngestionLogRow[];
}

export function IngestionHistoryTable({ data }: IngestionHistoryTableProps) {
  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border border-dashed p-12 text-center">
        <FileText className="mb-4 size-12 text-muted-foreground" />
        <h3 className="text-lg font-medium">No ingestion history</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Documents ingested via manual upload, bulk upload, or the API ingest
          endpoint will appear here.
        </p>
      </div>
    );
  }

  const vendorOptions = [
    ...new Set(data.map((r) => r.vendor ?? "Unknown")),
  ].map((v) => ({ label: v, value: v }));

  return (
    <DataTable
      columns={columns}
      data={data}
      searchPlaceholder="Search by document ID..."
      searchKey="invoiceNumber"
      facetedFilters={[
        {
          columnId: "outcome",
          title: "Status",
          options: [
            { label: "Success", value: "success" },
            { label: "Failed", value: "failed" },
          ],
        },
        {
          columnId: "vendor",
          title: "Vendor",
          options: vendorOptions,
        },
      ]}
    />
  );
}
