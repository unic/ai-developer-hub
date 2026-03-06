"use client";

import { useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
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
    header: "Invoice Number",
    cell: ({ row }) => (
      <span className="font-medium">{row.getValue("invoiceNumber")}</span>
    ),
  },
  {
    accessorKey: "invoiceDate",
    header: "Date",
    cell: ({ row }) => formatDate(row.getValue("invoiceDate")),
  },
  {
    accessorKey: "amountCents",
    header: "Amount",
    cell: ({ row }) => formatCurrency(row.getValue("amountCents")),
  },
  {
    accessorKey: "vendor",
    header: "Vendor",
    cell: ({ row }) => (row.getValue("vendor") as string) ?? "—",
  },
  {
    accessorKey: "periodLabel",
    header: "Budget Period",
    cell: ({ row }) => (row.getValue("periodLabel") as string) ?? "—",
  },
  {
    accessorKey: "uploaderName",
    header: "Uploaded By",
    cell: ({ row }) => (row.getValue("uploaderName") as string) ?? "—",
  },
  {
    id: "actions",
    header: "Download",
    cell: ({ row }) => (
      <Button variant="ghost" size="icon" asChild>
        <a
          href={`/api/invoices/${row.original.id}/pdf`}
          aria-label={`Download PDF for invoice ${row.original.invoiceNumber}`}
        >
          <Download className="size-4" />
        </a>
      </Button>
    ),
  },
];

export function InvoicesTable({ data }: { data: InvoiceRow[] }) {
  const memoizedColumns = useMemo(() => columns, []);

  return (
    <DataTable
      columns={memoizedColumns}
      data={data}
      searchPlaceholder="Search invoices..."
    />
  );
}
