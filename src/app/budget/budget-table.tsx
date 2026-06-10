"use client";

import { ColumnDef } from "@tanstack/react-table";
import { formatCurrency, formatVariance } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { DataTable, arrayIncludesFilterFn } from "@/components/data-table";
import { DataTableColumnHeader } from "@/components/data-table-column-header";
import { BudgetListActions } from "./budget-list-actions";

interface BudgetRow {
  id: number;
  fiscalYear: number;
  totalAmountCents: number;
  status: string;
  extensionCount: number;
  extensionNetCents: number;
}

const columns: ColumnDef<BudgetRow>[] = [
  {
    accessorKey: "fiscalYear",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Fiscal Year" />,
    cell: ({ row }) => (
      <span className="font-medium">FY {row.getValue("fiscalYear")}</span>
    ),
  },
  {
    accessorKey: "totalAmountCents",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Planned Amount" />,
    cell: ({ row }) => formatCurrency(row.getValue("totalAmountCents")),
  },
  {
    id: "extensions",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Extensions" />
    ),
    accessorFn: (row) => row.extensionCount,
    cell: ({ row }) => {
      const count = row.original.extensionCount;
      const net = row.original.extensionNetCents;
      if (count === 0)
        return <span className="text-muted-foreground">—</span>;
      return (
        <span className="inline-flex items-center gap-1.5 text-sm tabular-nums">
          <Badge variant="secondary">{count}</Badge>
          <span className={net < 0 ? "text-destructive" : "text-primary"}>
            {formatVariance(net)}
          </span>
        </span>
      );
    },
  },
  {
    accessorKey: "status",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => {
      const status = row.getValue("status") as string;
      return (
        <Badge variant={status === "active" ? "default" : "secondary"}>
          {status}
        </Badge>
      );
    },
    filterFn: arrayIncludesFilterFn,
  },
  {
    id: "actions",
    cell: ({ row }) => (
      <div className="text-right">
        <BudgetListActions
          id={row.original.id}
          fiscalYear={row.original.fiscalYear}
          status={row.original.status}
        />
      </div>
    ),
  },
];

const BUDGET_FACETED_FILTERS = [
  {
    columnId: "status",
    title: "Status",
    options: [
      { label: "Active", value: "active" },
      { label: "Archived", value: "archived" },
    ],
  },
];

export function BudgetTable({ data }: { data: BudgetRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={data}
      searchPlaceholder="Search budgets..."
      facetedFilters={BUDGET_FACETED_FILTERS}
    />
  );
}
