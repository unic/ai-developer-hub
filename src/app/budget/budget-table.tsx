"use client";

import { ColumnDef } from "@tanstack/react-table";
import { formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { BudgetListActions } from "./budget-list-actions";

interface BudgetRow {
  id: number;
  fiscalYear: number;
  totalAmountCents: number;
  status: string;
}

const columns: ColumnDef<BudgetRow>[] = [
  {
    accessorKey: "fiscalYear",
    header: "Fiscal Year",
    cell: ({ row }) => (
      <span className="font-medium">FY {row.getValue("fiscalYear")}</span>
    ),
  },
  {
    accessorKey: "totalAmountCents",
    header: "Planned Amount",
    cell: ({ row }) => formatCurrency(row.getValue("totalAmountCents")),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.getValue("status") as string;
      return (
        <Badge variant={status === "active" ? "default" : "secondary"}>
          {status}
        </Badge>
      );
    },
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

interface BudgetTableProps {
  data: BudgetRow[];
  isAdmin: boolean;
}

export function BudgetTable({ data }: BudgetTableProps) {
  return (
    <DataTable
      columns={columns}
      data={data}
      searchPlaceholder="Search budgets..."
    />
  );
}
