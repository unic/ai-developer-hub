# Data Model: Better Tables

**Feature**: 012-better-tables
**Date**: 2026-03-06

> This feature is UI-only — no database schema changes required. This document describes the **component model** (shared UI component interfaces and their relationships).

## Component Entities

### DataTableColumnHeader

Reusable sortable column header component that replaces the inline sort button pattern currently duplicated across tables.

**Props**:
- `column`: TanStack Table `Column` instance (provides sort state and toggle methods)
- `title`: Display text for the column header

**Behavior**:
- Renders a ghost button with the column title and sort indicator icon
- Click cycles through: unsorted → ascending → descending → unsorted
- Icon states: `ArrowUpDown` (unsorted), `ArrowUp` (ascending), `ArrowDown` (descending)
- Non-sortable columns render plain text (no button wrapper)

**Relationships**: Used by every column definition across all 5 tables

---

### DataTableFacetedFilter

Reusable faceted filter component for categorical columns with multi-select capability.

**Props**:
- `column`: TanStack Table `Column` instance (provides filter state)
- `title`: Display label for the filter
- `options`: Array of `{ label: string, value: string, icon?: LucideIcon }` describing available filter values

**Behavior**:
- Renders a button that opens a popover with a list of checkbox options
- Multiple selections allowed (union within the same filter)
- Active filter count shown as badge on the button
- "Clear filters" action resets the column filter
- Integrates with DataTable's `columnFilters` state

**Relationships**: Used by categorical columns (Status, Role, Vendor) in the DataTable toolbar area

---

### DataTableRowActions

Not a single shared component, but a **standardized pattern** for row action columns across all tables.

**Standard Actions** (direct buttons, always visible per permissions):

| Action | Icon | Tooltip | aria-label pattern | Visibility |
|--------|------|---------|-------------------|------------|
| View | `Eye` | "View" | "View {itemName}" | All users |
| Edit | `Pencil` | "Edit" | "Edit {itemName}" | Admin only |
| Download | `Download` | "Download" | "Download {itemName}" | All users (invoices only) |

**Overflow Menu Actions** (inside DropdownMenu, destructive):

| Action | Icon | Label | Variant | Visibility |
|--------|------|-------|---------|------------|
| Archive | `Archive` | "Archive" | destructive | Admin, non-archived items |
| Deactivate | `UserX` | "Deactivate" | destructive | Admin, active users |
| Revoke | `Ban` | "Revoke" | destructive | Admin, active assignments |
| Delete | `Trash2` | "Delete" | destructive | Admin, non-archived budgets |

**Overflow Menu Trigger**:
- Icon: `MoreHorizontal`
- Tooltip: "More actions"
- aria-label: "More actions for {itemName}"
- Only renders when user has permission for at least one destructive action on that row

**Relationships**: Each table's action column follows this pattern. The overflow menu trigger opens a DropdownMenu; selecting a destructive item sets component state to open the corresponding AlertDialog.

---

### Per-Table Column Configurations

#### Tools Table Columns

| Column | Sortable | Filterable | Filter Type |
|--------|----------|------------|-------------|
| Name | Yes | No (covered by global search) | — |
| Vendor | Yes | No (covered by global search) | — |
| Active Licenses | Yes | No | — |
| Status | Yes | Yes | Faceted: Active, Archived |
| Actions | No | No | — |

#### Users Table Columns

| Column | Sortable | Filterable | Filter Type |
|--------|----------|------------|-------------|
| Name | Yes | No (covered by global search) | — |
| Email | Yes | No (covered by global search) | — |
| Circle | Yes | No (keep existing "No Circle" toggle) | — |
| Role | Yes | Yes | Faceted: Admin, Viewer |
| Profile | Yes | No | — |
| Status | Yes | Yes | Faceted: Active, Inactive |
| Actions | No | No | — |

#### Assignments Table Columns

| Column | Sortable | Filterable | Filter Type |
|--------|----------|------------|-------------|
| User | Yes | No (covered by global search) | — |
| Tool | Yes | No (covered by global search) | — |
| Tier | Yes | No | — |
| Monthly Cost | Yes | No | — |
| Status | Yes | Yes | Faceted: Active, Revoked |
| Workspace | Yes | No (keep existing "No Workspace" toggle) | — |
| Assigned | Yes | No | — |
| Actions | No | No | — |

#### Invoices Table Columns (NEW — migrating to DataTable)

| Column | Sortable | Filterable | Filter Type |
|--------|----------|------------|-------------|
| Invoice Number | Yes | No | — |
| Date | Yes | No | — |
| Amount | Yes | No | — |
| Vendor | Yes | No (covered by global search) | — |
| Budget Period | Yes | No | — |
| Uploaded By | Yes | No | — |
| Actions (Download) | No | No | — |

#### Budget List Table Columns (NEW — migrating to DataTable)

| Column | Sortable | Filterable | Filter Type |
|--------|----------|------------|-------------|
| Fiscal Year | Yes | No | — |
| Planned Amount | Yes | No | — |
| Status | Yes | Yes | Faceted: Active, Archived |
| Actions | No | No | — |

## State Transitions

### Column Sort State

```
Unsorted → [click] → Ascending → [click] → Descending → [click] → Unsorted
```

### Overflow Menu → AlertDialog Flow

```
Row Actions visible
  → User clicks MoreHorizontal button
  → DropdownMenu opens
  → User clicks destructive item (e.g., "Archive")
  → DropdownMenu closes
  → AlertDialog opens with confirmation
  → User confirms → Action executes → Toast notification
  → User cancels → AlertDialog closes → No action
```
