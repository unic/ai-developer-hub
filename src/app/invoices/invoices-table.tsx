"use client";

import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { DataTableColumnHeader } from "@/components/data-table-column-header";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Download } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";

interface InvoiceRow {
  id: number;
  invoiceNumber: string;
  invoiceDate: Date | string | null;
  amountCents: number;
  vendor: string | null;
  uploaderName: string | null;
  periodLabel: string | null;
}

const columns: ColumnDef<InvoiceRow>[] = [
  {
    accessorKey: "invoiceNumber",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Invoice Number" />
    ),
    cell: ({ row }) => (
      <span className="font-medium">{row.getValue("invoiceNumber")}</span>
    ),
  },
  {
    accessorKey: "invoiceDate",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Date" />
    ),
    cell: ({ row }) => formatDate(row.getValue("invoiceDate")),
  },
  {
    accessorKey: "amountCents",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Amount" />
    ),
    cell: ({ row }) => formatCurrency(row.getValue("amountCents")),
  },
  {
    accessorKey: "vendor",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Vendor" />
    ),
    cell: ({ row }) => (row.getValue("vendor") as string) ?? "—",
  },
  {
    accessorKey: "periodLabel",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Budget Period" />
    ),
    cell: ({ row }) => (row.getValue("periodLabel") as string) ?? "—",
  },
  {
    accessorKey: "uploaderName",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Uploaded By" />
    ),
    cell: ({ row }) => (row.getValue("uploaderName") as string) ?? "—",
  },
  {
    id: "actions",
    cell: ({ row }) => (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Download invoice ${row.original.invoiceNumber}`}
            asChild
          >
            <a href={`/api/invoices/${row.original.id}/pdf`}>
              <Download className="size-4" />
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Download</TooltipContent>
      </Tooltip>
    ),
  },
];

export function InvoicesTable({ data }: { data: InvoiceRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={data}
      searchPlaceholder="Search invoices..."
    />
  );
}
