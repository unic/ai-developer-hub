# Research: Better Tables

**Feature**: 012-better-tables
**Date**: 2026-03-06

## R1: Existing Table Infrastructure

### Decision: Extend Existing DataTable Component

**Rationale**: The shared `DataTable` component at `src/components/data-table.tsx` already integrates TanStack Table v8 with sorting (`getSortedRowModel`), filtering (`getFilteredRowModel`), and pagination. Rather than building new components, extend this shared component and migrate the remaining plain HTML tables to use it.

**Alternatives Considered**:
- Build separate enhanced table components per page — rejected due to code duplication and inconsistency
- Replace TanStack Table with a different library — rejected since TanStack Table v8 is already installed, well-integrated, and meets all requirements

### Current State

| Table | Component | Uses DataTable | Sorting | Filtering | Pagination |
|-------|-----------|---------------|---------|-----------|------------|
| Tools | `tools-table.tsx` | Yes | Name, Vendor only | Global search | Yes |
| Users | `users-table.tsx` | Yes | Name, Circle only | Global search + "No Circle" toggle | Yes |
| Assignments | `assignments-client.tsx` | Yes | None | Global search + "No Workspace" toggle | Yes |
| Invoices | `invoices/page.tsx` | No (plain Table) | None | None | None |
| Budget List | `budget/page.tsx` | No (plain Table) | None | None | None |

### Tables Excluded from Scope

- **Budget Detail (periods/billed costs)**: Hierarchical expandable table with inline editing — too specialized for the shared DataTable pattern. Sorting/filtering not applicable (small, fixed dataset per budget).
- **Bulk Upload Review**: Editable review table with confidence scoring — specialized workflow, not a standard data browsing table.
- **Bulk Upload Results**: Simple outcome summary — no need for sorting/filtering.

## R2: Sorting Implementation Pattern

### Decision: Use TanStack Table Column-Level Sorting with Three-State Cycle

**Rationale**: TanStack Table v8 natively supports `enableSorting` per column and the `toggleSorting()` API. The existing pattern in tools-table.tsx and users-table.tsx uses `ArrowUpDown` icon with `column.toggleSorting()` — extend this to all data columns.

**Implementation Pattern** (already established in codebase):
```tsx
header: ({ column }) => (
  <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
    Column Name
    <ArrowUpDown className="ml-2 size-4" />
  </Button>
)
```

**Enhancement**: Replace `ArrowUpDown` with directional indicators (`ArrowUp`, `ArrowDown`) when actively sorted, keeping `ArrowUpDown` for the unsorted state. Use TanStack's built-in `enableSortingRemoval: true` for three-state cycling (asc → desc → none).

**Alternatives Considered**:
- Server-side sorting via query params — rejected; dataset sizes are small enough for client-side sorting
- Custom sort comparators — not needed for standard text, number, and date columns; TanStack handles these natively

## R3: Column Filtering Pattern

### Decision: Use Faceted Filters for Categorical Columns

**Rationale**: The shadcn/ui DataTable examples demonstrate a "faceted filter" pattern using `DropdownMenuCheckboxItem` or a popover with checkbox list for categorical columns. This allows multi-select filtering (e.g., show both "active" and "suspended" statuses simultaneously).

**Columns to Add Filters**:
| Table | Column | Filter Type | Values |
|-------|--------|-------------|--------|
| Tools | Status | Faceted (multi-select) | Active, Archived |
| Users | Role | Faceted (multi-select) | Admin, Viewer |
| Users | Status | Faceted (multi-select) | Active, Inactive |
| Assignments | Status | Faceted (multi-select) | Active, Revoked |

**Existing Custom Filters**: The "No Circle" and "No Workspace" toggle buttons will remain as-is — they serve a specific workflow need and are already well-understood by users.

**Alternatives Considered**:
- Replace custom toggles with column filters — rejected; the toggles serve a different UX purpose (quick-access boolean filter vs. multi-select categorical)
- Add text-based column search for all columns — rejected; global search already covers text matching

## R4: Overflow Menu for Destructive Actions

### Decision: Use shadcn/ui DropdownMenu with MoreHorizontal Trigger

**Rationale**: The `DropdownMenu` component already exists at `src/components/ui/dropdown-menu.tsx` with full Radix UI accessibility support and a `variant="destructive"` option on `DropdownMenuItem`. The `MoreHorizontal` icon from Lucide React is the standard three-dot menu trigger.

**Pattern**:
- Direct action buttons: View (Eye), Edit (Pencil) — always visible based on permissions
- Overflow menu (MoreHorizontal): Contains Archive, Deactivate, Revoke, Delete — only renders when user has permission for at least one item
- Each destructive menu item opens the existing AlertDialog for confirmation
- Menu items use `variant="destructive"` for visual distinction

**Challenge**: AlertDialog currently uses `AlertDialogTrigger` as the direct button. Moving destructive actions into a DropdownMenu requires changing the trigger mechanism — the DropdownMenuItem will set state to open the AlertDialog rather than wrapping the trigger.

**Alternatives Considered**:
- Nested AlertDialog inside DropdownMenuItem — problematic due to Radix UI portal conflicts
- Custom confirmation modal instead of AlertDialog — rejected; AlertDialog is already well-tested and consistent

## R5: Tooltip and Accessibility Pattern

### Decision: Wrap All Action Buttons with Tooltip Component

**Rationale**: The `Tooltip` component exists at `src/components/ui/tooltip.tsx` with zero-delay configuration. Currently, action buttons use `<span className="sr-only">` for screen reader labels but have no visual tooltips on hover. Adding tooltips improves discoverability for sighted users while maintaining screen reader accessibility.

**Pattern**:
```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <Button variant="ghost" size="sm" aria-label="View Cursor Pro">
      <Eye className="size-4" />
    </Button>
  </TooltipTrigger>
  <TooltipContent>View</TooltipContent>
</Tooltip>
```

**Accessibility Labels**: Format as `"[Action] [item name]"` for `aria-label` attributes, e.g., "View Cursor Pro", "Edit Alice Smith", "More actions for Budget FY2026".

**Alternatives Considered**:
- HTML `title` attribute instead of Tooltip component — rejected; `title` has inconsistent behavior across browsers and is not reliably accessible

## R6: Invoices and Budget Table Migration

### Decision: Convert to Client Components Using DataTable

**Rationale**: Both the Invoices list (`invoices/page.tsx`) and Budget list (`budget/page.tsx`) currently render as server components with plain HTML tables. To gain sorting, filtering, and pagination, they need to be split into a server component (data fetching) and a client component (DataTable rendering), following the established pattern in tools and users.

**Migration Pattern**:
1. Keep the page.tsx as a server component for data fetching
2. Extract table rendering into a new client component (e.g., `invoices-table.tsx`, `budget-table.tsx`)
3. Pass fetched data as props to the client component
4. Define column definitions with sorting enabled on all data columns

**Alternatives Considered**:
- Add sorting/filtering to server components via URL query params — rejected; would require full page reloads and is inconsistent with the client-side pattern used elsewhere
- Keep as plain tables — rejected; contradicts the feature requirement of universal sorting
