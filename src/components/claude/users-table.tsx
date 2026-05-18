"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { ChevronRight, ChevronsUpDown, CheckIcon, PlusCircle, ArrowUp, ArrowDown } from "lucide-react";
import type { UserListRow } from "@/types";
import { cn, formatCurrency } from "@/lib/utils";

const HIDE_ZERO_KEY = "claude-users:hide-zero";
const SEARCH_DEBOUNCE_MS = 200;
const NO_WORKSPACE = "__no_workspace__";
const NO_CIRCLE = "__no_circle__";
const NO_PROFILE = "__no_profile__";

type FilterOption = { value: string; label: string };

type Props = {
  users: UserListRow[];
};

export function UsersTable({ users }: Props) {
  // Hide-$0 toggle — default ON, persisted to localStorage.
  const [hideZero, setHideZero] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(HIDE_ZERO_KEY);
      if (stored != null) setHideZero(stored === "true");
    } catch {
      // ignore
    }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(HIDE_ZERO_KEY, String(hideZero));
    } catch {
      // ignore
    }
  }, [hideZero, hydrated]);

  // Filters
  const [workspaceFilter, setWorkspaceFilter] = useState<Set<string>>(new Set());
  const [circleFilter, setCircleFilter] = useState<Set<string>>(new Set());
  const [profileFilter, setProfileFilter] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Build distinct option lists from the dataset itself so we don't render
  // filters for values that aren't present.
  const workspaceOptions = useMemo<FilterOption[]>(() => {
    const map = new Map<string, string>();
    for (const u of users) {
      const key = u.workspaceId ?? NO_WORKSPACE;
      const label = u.workspaceName ?? "No workspace";
      if (!map.has(key)) map.set(key, label);
    }
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [users]);

  const circleOptions = useMemo<FilterOption[]>(() => {
    const map = new Map<string, string>();
    for (const u of users) {
      const key = u.circle ?? NO_CIRCLE;
      const label = u.circle ?? "No circle";
      if (!map.has(key)) map.set(key, label);
    }
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [users]);

  const profileOptions = useMemo<FilterOption[]>(() => {
    const map = new Map<string, string>();
    for (const u of users) {
      const key = u.profile ?? NO_PROFILE;
      const label = u.profile ?? "No profile";
      if (!map.has(key)) map.set(key, label);
    }
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [users]);

  const filtered = useMemo(() => {
    return users.filter((u) => {
      if (hideZero && u.costCents === 0) return false;
      if (workspaceFilter.size > 0) {
        const key = u.workspaceId ?? NO_WORKSPACE;
        if (!workspaceFilter.has(key)) return false;
      }
      if (circleFilter.size > 0) {
        const key = u.circle ?? NO_CIRCLE;
        if (!circleFilter.has(key)) return false;
      }
      if (profileFilter.size > 0) {
        const key = u.profile ?? NO_PROFILE;
        if (!profileFilter.has(key)) return false;
      }
      if (search.length > 0) {
        const hay = `${u.name} ${u.email}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }, [users, hideZero, workspaceFilter, circleFilter, profileFilter, search]);

  const filtersActive =
    workspaceFilter.size > 0 ||
    circleFilter.size > 0 ||
    profileFilter.size > 0 ||
    search.length > 0;

  function clearFilters() {
    setWorkspaceFilter(new Set());
    setCircleFilter(new Set());
    setProfileFilter(new Set());
    setSearch("");
    setSearchInput("");
  }

  const columns = useMemo<ColumnDef<UserListRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "User",
        enableSorting: false,
        cell: ({ row }) => {
          const u = row.original;
          return (
            <div className="min-w-0">
              <p className="truncate font-medium">{u.name || u.email}</p>
              <p className="truncate text-xs text-muted-foreground">{u.email}</p>
            </div>
          );
        },
      },
      {
        accessorKey: "workspaceName",
        header: "Workspace",
        enableSorting: false,
        cell: ({ row }) => {
          const u = row.original;
          if (!u.workspaceName) {
            return <span className="text-muted-foreground">—</span>;
          }
          return (
            <div className="flex items-center gap-2">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: u.workspaceColor ?? "#a1a1aa" }}
                aria-hidden
              />
              <span className="truncate">{u.workspaceName}</span>
            </div>
          );
        },
      },
      {
        accessorKey: "modelsUsed",
        header: ({ column }) => (
          <SortHeader column={column} label="Models" align="right" />
        ),
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">
            {row.original.modelsUsed === 0 ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              row.original.modelsUsed
            )}
          </span>
        ),
      },
      {
        accessorKey: "totalTokens",
        header: ({ column }) => (
          <SortHeader column={column} label="Tokens" align="right" />
        ),
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">
            {row.original.totalTokens === 0 ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              row.original.totalTokens.toLocaleString()
            )}
          </span>
        ),
      },
      {
        accessorKey: "costCents",
        header: ({ column }) => (
          <SortHeader column={column} label="Cost MTD" align="right" />
        ),
        cell: ({ row }) => (
          <span className="block text-right font-medium tabular-nums">
            {formatCurrency(row.original.costCents)}
          </span>
        ),
      },
      {
        accessorKey: "lastActive",
        header: ({ column }) => (
          <SortHeader column={column} label="Last active" align="right" />
        ),
        cell: ({ row }) => (
          <span className="block text-right text-sm text-muted-foreground tabular-nums">
            {formatRelativeDate(row.original.lastActive)}
          </span>
        ),
        sortingFn: (a, b) => {
          const av = a.original.lastActive ?? "";
          const bv = b.original.lastActive ?? "";
          return av.localeCompare(bv);
        },
      },
      {
        id: "drill",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            href={`/profile?userId=${row.original.userId}`}
            className="inline-flex items-center text-muted-foreground transition-colors hover:text-foreground"
            aria-label={`Drill into ${row.original.name || row.original.email}`}
          >
            <ChevronRight className="size-4" />
          </Link>
        ),
      },
    ],
    []
  );

  const [sorting, setSorting] = useState<SortingState>([
    { id: "costCents", desc: true },
  ]);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search users by name or email…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="h-8 max-w-xs"
        />
        <MultiSelectFilter
          title="Workspace"
          options={workspaceOptions}
          selected={workspaceFilter}
          onChange={setWorkspaceFilter}
        />
        <MultiSelectFilter
          title="Circle"
          options={circleOptions}
          selected={circleFilter}
          onChange={setCircleFilter}
        />
        <MultiSelectFilter
          title="Profile"
          options={profileOptions}
          selected={profileFilter}
          onChange={setProfileFilter}
        />
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <span>Hide $0 users</span>
          <Switch
            checked={hideZero}
            onCheckedChange={setHideZero}
            aria-label="Hide users with $0 spend this period"
          />
        </label>
      </div>

      <div className="overflow-x-auto rounded-md border">
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
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  id={`user-${row.original.userId}`}
                  className="scroll-mt-24"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  <div className="flex flex-col items-center gap-2">
                    <p>No matching users.</p>
                    {filtersActive && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={clearFilters}
                      >
                        Clear filters
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <p className="px-1 text-[11px] text-muted-foreground">
        Per-user totals come from Anthropic&apos;s usage endpoint and will not
        exactly match org or workspace headline costs (different rounding and
        aggregation windows). Mid-month workspace moves attribute historical
        usage to the user&apos;s current workspace.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header sort helper
// ---------------------------------------------------------------------------

function SortHeader<TData>({
  column,
  label,
  align = "left",
}: {
  column: import("@tanstack/react-table").Column<TData, unknown>;
  label: string;
  align?: "left" | "right";
}) {
  const sort = column.getIsSorted();
  return (
    <button
      type="button"
      onClick={() => column.toggleSorting(sort === "asc")}
      className={cn(
        "inline-flex w-full items-center gap-1 text-xs font-medium uppercase tracking-wider transition-colors hover:text-foreground",
        align === "right" ? "justify-end text-right" : "text-left"
      )}
    >
      <span>{label}</span>
      {sort === "asc" ? (
        <ArrowUp className="size-3" />
      ) : sort === "desc" ? (
        <ArrowDown className="size-3" />
      ) : (
        <ChevronsUpDown className="size-3 opacity-40" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Multi-select popover filter (mirrors `data-table-faceted-filter.tsx`)
// ---------------------------------------------------------------------------

function MultiSelectFilter({
  title,
  options,
  selected,
  onChange,
}: {
  title: string;
  options: FilterOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  if (options.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 border-dashed">
          <PlusCircle className="mr-2 size-4" />
          {title}
          {selected.size > 0 && (
            <>
              <Separator orientation="vertical" className="mx-2 h-4" />
              <Badge variant="secondary" className="rounded-sm px-1 font-normal lg:hidden">
                {selected.size}
              </Badge>
              <div className="hidden space-x-1 lg:flex">
                {selected.size > 2 ? (
                  <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                    {selected.size} selected
                  </Badge>
                ) : (
                  options
                    .filter((opt) => selected.has(opt.value))
                    .map((opt) => (
                      <Badge
                        key={opt.value}
                        variant="secondary"
                        className="rounded-sm px-1 font-normal"
                      >
                        {opt.label}
                      </Badge>
                    ))
                )}
              </div>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const isSelected = selected.has(opt.value);
                return (
                  <CommandItem
                    key={opt.value}
                    onSelect={() => {
                      const next = new Set(selected);
                      if (isSelected) next.delete(opt.value);
                      else next.add(opt.value);
                      onChange(next);
                    }}
                  >
                    <div
                      className={cn(
                        "mr-2 flex size-4 items-center justify-center rounded-sm border border-primary",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "opacity-50 [&_svg]:invisible"
                      )}
                    >
                      <CheckIcon className="size-4" />
                    </div>
                    <span className="truncate">{opt.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {selected.size > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => onChange(new Set())}
                    className="justify-center text-center"
                  >
                    Clear
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Relative date helper (today / Nd ago / Mon dd)
// ---------------------------------------------------------------------------

function formatRelativeDate(isoDate: string | null): string {
  if (!isoDate) return "—";
  // Parse as a date in the local timezone — anthropic_usage_metrics.date is
  // calendar-day, not a timestamp, so a UTC interpretation would shift by up
  // to a day for west-of-UTC viewers.
  const d = new Date(`${isoDate}T00:00:00`);
  const now = new Date();
  const diffMs = now.setHours(0, 0, 0, 0) - d.getTime();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
