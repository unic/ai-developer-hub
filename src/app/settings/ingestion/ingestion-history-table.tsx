"use client";

import { useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable, arrayIncludesFilterFn } from "@/components/data-table";
import { DataTableColumnHeader } from "@/components/data-table-column-header";
import { ErrorPopover } from "@/components/error-popover";
import { OutcomeBadge } from "@/components/outcome-badge";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime } from "@/lib/utils";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { INGESTION_TYPES, presentKinds } from "@/lib/ingestion/registry";
import type { IngestionLogRow } from "@/actions/ingestion-log";
import type { IngestionKind } from "@/types";

const columns: ColumnDef<IngestionLogRow>[] = [
  {
    accessorKey: "kind",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Kind" />
    ),
    cell: ({ row }) => {
      const kind = row.getValue<IngestionKind>("kind");
      const def = INGESTION_TYPES[kind];
      const Icon = def.icon;
      return (
        <Badge variant="outline" className="gap-1.5">
          <Icon className="size-3" />
          {def.label}
        </Badge>
      );
    },
    filterFn: arrayIncludesFilterFn,
  },
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
    accessorKey: "label",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Summary" />
    ),
    cell: ({ row }) => {
      const label = row.getValue<string | null>("label");
      // Fallback for legacy rows logged before 034 populated `label`.
      const fallback = row.original.vendor;
      const text = label ?? fallback;
      return text ? (
        <span className="font-medium">{text}</span>
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
      const channel = row.getValue<string>("channel");
      return channel.charAt(0).toUpperCase() + channel.slice(1);
    },
    filterFn: arrayIncludesFilterFn,
  },
  {
    accessorKey: "uploaderName",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Source" />
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
    id: "drill",
    header: "",
    cell: ({ row }) => {
      const def = INGESTION_TYPES[row.original.kind];
      const href = def.drillThrough(row.original);
      const Icon = def.icon;
      if (!href) {
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" disabled className="size-8">
                <Icon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Nothing to open</TooltipContent>
          </Tooltip>
        );
      }
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" asChild>
              <a
                href={href}
                {...(def.drillNewTab
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                <Icon className="size-4" />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{def.drillLabel}</TooltipContent>
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
  // Sub-tabs (Q2) are the primary control; they set the kind filter. "All"
  // keeps every row. The tab set is derived from kinds actually present.
  const [tab, setTab] = useState<IngestionKind | "all">("all");

  const tabs = useMemo(() => presentKinds(data), [data]);

  const rows = useMemo(() => {
    const filtered = tab === "all" ? data : data.filter((r) => r.kind === tab);
    // Normalise `label` so search (searchKey="label") still works on legacy
    // rows logged before 034 populated it — mirrors the Summary cell fallback.
    return filtered.map((r) => ({ ...r, label: r.label ?? r.vendor }));
  }, [data, tab]);

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border border-dashed p-12 text-center">
        <Inbox className="mb-4 size-12 text-muted-foreground" />
        <h3 className="text-lg font-medium">No ingestion history</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Invoices and license requests ingested via manual upload, bulk upload,
          or the API endpoints will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {tabs.length > 1 && (
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as IngestionKind | "all")}
        >
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            {tabs.map((k) => (
              <TabsTrigger key={k} value={k}>
                {INGESTION_TYPES[k].label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="Search summary..."
        searchKey="label"
        facetedFilters={[
          {
            columnId: "outcome",
            title: "Status",
            options: [
              { label: "Success", value: "success" },
              { label: "Failed", value: "failed" },
              { label: "Filtered", value: "filtered" },
            ],
          },
        ]}
      />
    </div>
  );
}
