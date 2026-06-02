"use client";

import { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface DataTableColumnHeaderProps<TData, TValue> {
  column: Column<TData, TValue>;
  title: string;
  className?: string;
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return <div className={cn(className)}>{title}</div>;
  }

  const sorted = column.getIsSorted();

  return (
    <button
      type="button"
      onClick={() => {
        if (sorted === "desc") {
          column.clearSorting();
        } else {
          column.toggleSorting(sorted === "asc");
        }
      }}
      // Matches the <th> label treatment (a <button> does NOT inherit
      // text-transform/font reliably) and carries no padding/height of its own,
      // so the label stays flush with the column's cells.
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.1em] uppercase text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground",
        sorted && "text-foreground",
        className
      )}
    >
      {title}
      {sorted === "desc" ? (
        <ArrowDown className="size-3.5" />
      ) : sorted === "asc" ? (
        <ArrowUp className="size-3.5" />
      ) : (
        <ArrowUpDown className="size-3.5 opacity-50" />
      )}
    </button>
  );
}
