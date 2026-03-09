# UI Contracts: Better Tables

**Feature**: 012-better-tables
**Date**: 2026-03-06

## Component Contracts

### DataTableColumnHeader

**Location**: `src/components/data-table-column-header.tsx`

**Props**:
```typescript
interface DataTableColumnHeaderProps<TData, TValue> {
  column: Column<TData, TValue>
  title: string
  className?: string
}
```

**Rendering Rules**:
- If `column.getCanSort()` is false → render plain `<div>` with title text
- If `column.getCanSort()` is true → render `<Button variant="ghost">` with:
  - Title text
  - Sort icon: `ArrowDown` if sorted desc, `ArrowUp` if sorted asc, `ArrowUpDown` if unsorted
  - Click handler: `column.toggleSorting()`

---

### DataTableFacetedFilter

**Location**: `src/components/data-table-faceted-filter.tsx`

**Props**:
```typescript
interface DataTableFacetedFilterProps<TData, TValue> {
  column?: Column<TData, TValue>
  title: string
  options: { label: string; value: string; icon?: ComponentType<{ className?: string }> }[]
}
```

**Rendering Rules**:
- Renders a `<Button variant="outline" size="sm">` that opens a `<Popover>`
- Button displays: `<PlusCircle />` icon + title + optional badge with count of selected values
- Popover content: scrollable list of `<CommandItem>` checkboxes for each option
- Selecting/deselecting an option updates `column.setFilterValue()`
- "Clear filters" separator + button at bottom when any filter active
- If selected count > 2, show `"{count} selected"` badge instead of individual value badges

---

### Row Action Buttons

**Pattern** (not a standalone component — applied inline in each table's column definitions):

**Standard Action Button Contract**:
```typescript
// Every action button MUST be wrapped in Tooltip
<Tooltip>
  <TooltipTrigger asChild>
    <Button
      variant="ghost"
      size="sm"
      aria-label={`${actionVerb} ${itemName}`}  // REQUIRED
    >
      <IconComponent className="size-4" />
    </Button>
  </TooltipTrigger>
  <TooltipContent>{actionVerb}</TooltipContent>
</Tooltip>
```

**Overflow Menu Contract**:
```typescript
// Only renders when user has permission for >= 1 destructive action
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button
      variant="ghost"
      size="sm"
      aria-label={`More actions for ${itemName}`}
    >
      <MoreHorizontal className="size-4" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuItem
      variant="destructive"
      onSelect={() => setDialogOpen(true)}
    >
      <IconComponent className="size-4" />
      {actionLabel}
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
// AlertDialog rendered separately, controlled by state
<AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
  {/* existing confirmation content */}
</AlertDialog>
```

---

## Icon Registry

Canonical icon assignments for row actions. These MUST NOT vary across tables.

| Action | Icon | Tooltip Text | aria-label Format |
|--------|------|-------------|-------------------|
| View | `Eye` | "View" | "View {name}" |
| Edit | `Pencil` | "Edit" | "Edit {name}" |
| Download | `Download` | "Download" | "Download {name}" |
| More Actions | `MoreHorizontal` | "More actions" | "More actions for {name}" |
| Archive | `Archive` | — (in menu) | — (menu item, no separate aria-label) |
| Deactivate | `UserX` | — (in menu) | — |
| Revoke | `Ban` | — (in menu) | — |
| Delete | `Trash2` | — (in menu) | — |

---

## DataTable Enhancement Contract

**Location**: `src/components/data-table.tsx`

**Change**: Wrap the entire DataTable output in `<TooltipProvider>` to enable tooltips for all action buttons without requiring each page to add its own provider.

**Enhanced Props** (additive, backward-compatible):
```typescript
interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  searchPlaceholder?: string
  searchKey?: string
  facetedFilters?: {                    // NEW
    columnId: string
    title: string
    options: { label: string; value: string }[]
  }[]
}
```

**Rendering Rules for Faceted Filters**:
- If `facetedFilters` is provided, render filter buttons in a toolbar row between the search input and the table
- Each filter button renders a `DataTableFacetedFilter` for the specified column
- Filters work alongside global search (intersection)
