# Quickstart: Better Tables

**Feature**: 012-better-tables
**Date**: 2026-03-06

## Overview

This feature standardizes all data tables with sorting, filtering, tooltips, accessible labels, and a three-dot overflow menu for destructive actions. No database changes — purely a UI refactor.

## Prerequisites

- Node.js LTS + pnpm installed
- Local dev server runs: `pnpm dev`
- No new dependencies to install — all required packages already present

## Key Files to Understand

1. **`src/components/data-table.tsx`** — Shared DataTable wrapper around TanStack Table. All tables use this (or will after migration).
2. **`src/components/ui/dropdown-menu.tsx`** — shadcn/ui DropdownMenu with `variant="destructive"` support. Used for the new overflow menu.
3. **`src/components/ui/tooltip.tsx`** — shadcn/ui Tooltip with zero-delay. Used for action button tooltips.

## Implementation Order

### Phase 1: Shared Components
Create reusable `DataTableColumnHeader` and `DataTableFacetedFilter` components in `src/components/`. These are used by all tables.

### Phase 2: Update Existing Tables (Tools → Users → Assignments)
For each table:
1. Replace inline sort button headers with `DataTableColumnHeader`
2. Enable sorting on all data columns
3. Add tooltips to all action buttons
4. Add `aria-label` attributes to all action buttons
5. Move destructive actions into DropdownMenu overflow
6. Wire DropdownMenu items to existing AlertDialog confirmations
7. Add faceted filters for categorical columns

### Phase 3: Migrate Plain Tables (Invoices, Budget List)
1. Create client components (`invoices-table.tsx`, `budget-table.tsx`)
2. Move table rendering from server page to client component
3. Define column definitions with sorting enabled
4. Apply the same action patterns (tooltips, overflow menu)

### Phase 4: Testing
1. Unit tests for shared components
2. E2E tests for cross-table consistency

## Verification

```bash
pnpm typecheck     # No TypeScript errors
pnpm lint          # No ESLint warnings
pnpm test          # Unit tests pass
pnpm dev           # Manual verification: visit /tools, /users, /assignments, /invoices, /budget
```

## Key Patterns

### Sortable Column Header
```tsx
// Before (inline, duplicated):
header: ({ column }) => (
  <Button variant="ghost" onClick={() => column.toggleSorting(...)}>
    Name <ArrowUpDown className="ml-2 size-4" />
  </Button>
)

// After (shared component):
header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />
```

### Overflow Menu for Destructive Actions
```tsx
// Before (direct button):
<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button size="sm" variant="ghost"><Archive /></Button>
  </AlertDialogTrigger>
  ...
</AlertDialog>

// After (menu item → state → dialog):
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="sm"><MoreHorizontal /></Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem variant="destructive" onSelect={() => setShowArchiveDialog(true)}>
      <Archive /> Archive
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
<AlertDialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>...</AlertDialog>
```

### Tooltip on Action Button
```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <Button variant="ghost" size="sm" aria-label={`View ${itemName}`} asChild>
      <Link href={`/resource/${id}`}><Eye className="size-4" /></Link>
    </Button>
  </TooltipTrigger>
  <TooltipContent>View</TooltipContent>
</Tooltip>
```
