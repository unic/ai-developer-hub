# Data Model: 006-optional-fields-ux

**Date**: 2026-03-05
**Branch**: `006-optional-fields-ux`

---

## Schema Changes

### 1. `users.circle` — Remove NOT NULL constraint

**Current definition** (Drizzle):
```
circle: varchar("circle", { length: 100 }).notNull()
```

**New definition**:
```
circle: varchar("circle", { length: 100 })
```

**Migration SQL** (generated via `pnpm db:generate`):
```sql
ALTER TABLE "users" ALTER COLUMN "circle" DROP NOT NULL;
```

**Index impact**: The existing `users_circle_idx` on `circle` remains. PostgreSQL indexes nullable columns without issue; NULL values are indexed and can be queried with `IS NULL`.

**Downstream impact**:
- TypeScript inferred type changes from `string` to `string | null`
- All code paths reading `user.circle` must handle `null`
- Display components must render `"—"` when circle is null

---

### 2. `licenseAssignments.workspace` — No schema change required

**Current definition** (Drizzle):
```
workspace: varchar("workspace", { length: 200 })
```

Already nullable — no migration needed.

---

## Validator Changes

### `userSchema` (used by create-user form and `createUser` action)

**Current**:
```ts
circle: z.string().min(1, "Circle is required").max(100)
```

**New**:
```ts
circle: z.string().max(100).optional()
```

### `bulkImportUserSchema` (used by bulk import)

**Current**:
```ts
circle: z.string().min(1, "Circle is required").max(100)
```

**New**:
```ts
circle: z.string().max(100).optional()
```

### `updateUserSchema` (used by edit-user form)

**Current**:
```ts
circle: z.string().min(1).max(100).optional()
```

**New**:
```ts
circle: z.string().max(100).optional().nullable()
```

(Allows explicitly setting circle to null to clear it, matching how `profile` is handled.)

### `bulkImportAssignmentRowSchema` (used by assignment bulk import)

**Current**:
```ts
workspace: z.string().min(1).max(200)
```

**New**:
```ts
workspace: z.string().max(200).optional()
```

---

## Derived Type Changes

The `User` TypeScript type (inferred from the schema or defined in `src/types/`) must reflect `circle: string | null`. Any display code reading `user.circle` must be updated to handle null.

Similarly, the `BulkImportUserInput` type must reflect `circle?: string | undefined`.

---

## Server Action Changes

### `createUser` (`src/actions/users.ts`)

Change:
```ts
const { name, email, password, circle, role, githubUsername, profile } = parsed.data;
// ...
.values({ name, email, passwordHash, circle, role, ... })
```

To:
```ts
.values({ name, email, passwordHash, circle: circle ?? null, role, ... })
```

### `bulkImportUsers` (`src/actions/users.ts`)

Change:
```ts
const { name, email, circle, role, githubUsername, profile } = parsed.data;
// ...
.values({ ..., circle, role: role ?? "viewer", ... })
```

To:
```ts
.values({ ..., circle: circle ?? null, role: role ?? "viewer", ... })
```

### `bulkImportAssignments` (`src/actions/assignments.ts`)

The `validatedRows` local type annotation includes `workspace: string`. Update to `workspace?: string`. The insert already does `workspace` as a direct pass-through value — change to `workspace: workspace ?? null` to make null intent explicit.

---

## New Server Action

### `archiveBudget` (`src/actions/budget.ts`)

```
archiveBudget(input: { id: number }): Promise<ActionResult<void>>
```

- Requires admin authentication
- Validates budget exists and is currently `active`
- Sets `status = "archived"`
- Records status change in `change_history`
- Revalidates `/budget`

---

## UI Component Changes

### `DataTable` (`src/components/data-table.tsx`)

New features:
- Page-size selector (Select component with options [10, 25, 50, 100], default 10)
- Renders in the pagination row alongside Previous/Next buttons
- Resets to page 1 when page size changes (TanStack Table handles this automatically)
- Exposes `columnFilters` / `setColumnFilters` — already in state; no API change needed since tables pass column definitions with custom filterFns

### Quick Action Column Patterns

**Users table** — Actions column (admin only):

| Button | Icon | Action |
|--------|------|--------|
| View | `Eye` | `Link href="/users/[id]"` |
| Edit | `Pencil` | `Link href="/users/[id]"` (detail page hosts edit form) |
| Deactivate | `UserX` or `Trash2` | AlertDialog → `deactivateUser({ id })` |

**Tools table** — Actions column (admin only):

| Button | Icon | Action |
|--------|------|--------|
| View | `Eye` | `Link href="/tools/[id]"` |
| Edit | `Pencil` | `Link href="/tools/[id]"` (detail page hosts edit form) |
| Archive | `Archive` | AlertDialog → `archiveTool({ id })` — disabled if active assignments > 0 |

**Assignments list** — Actions column (admin only for edit/revoke; view available to all):

| Button | Icon | Action |
|--------|------|--------|
| View | `Eye` | `Link href="/assignments/[id]"` |
| Edit | `Pencil` | Opens `EditAssignmentDialog` (existing) |
| Revoke | `Ban` or `Trash2` | AlertDialog → `revokeLicense({ id })` |

**Budget list** — Actions column (admin only for archive; view available to all):

| Button | Icon | Action |
|--------|------|--------|
| View | `Eye` | `Link href="/budget/[id]"` |
| Archive | `Archive` | AlertDialog → `archiveBudget({ id })` |

---

## Filter UI Changes

### Circle filter on Users overview

- A "No Circle" toggle button above (or beside) the search input in `UsersTable`
- When active: filters the TanStack Table to show only rows where `circle` is null/empty
- Implementation: `table.getColumn("circle")?.setFilterValue("__none__")` / clear filter
- Custom `filterFn` on circle column definition:
  ```ts
  filterFn: (row, _columnId, filterValue) => {
    if (filterValue === "__none__") return !row.getValue("circle");
    return true;
  }
  ```

### Workspace filter on Assignments overview

- Same "No Workspace" toggle button pattern
- Applied to the workspace column in `AssignmentsClient`
