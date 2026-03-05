# Research: 006-optional-fields-ux

**Date**: 2026-03-05
**Branch**: `006-optional-fields-ux`

---

## Decision 1: Optional Circle Field — Schema Change Strategy

**Decision**: Change `users.circle` from `NOT NULL` to nullable in the PostgreSQL schema, with a corresponding Drizzle migration.

**Rationale**: The `users.circle` column is currently defined as `varchar("circle", { length: 100 }).notNull()`. Since circle is a free-text field (confirmed via clarification), making it optional requires only removing `.notNull()` from the Drizzle definition and generating a migration that runs `ALTER TABLE users ALTER COLUMN circle DROP NOT NULL`. The existing `users_circle_idx` index on the column remains valid — PostgreSQL handles nullable indexed columns without issue.

**Alternatives considered**:
- Default to empty string instead of NULL — rejected because it conflates "not set" with "set to empty", breaks the `"None / Unassigned"` filter pattern, and is inconsistent with how other optional fields (e.g., `githubUsername`) are stored.

**Files affected**:
- `src/lib/db/schema.ts` — remove `.notNull()` from `users.circle`
- `src/lib/db/migrations/` — new migration file via `pnpm db:generate`
- `src/lib/validators.ts` — `userSchema`, `bulkImportUserSchema`, `updateUserSchema`
- `src/actions/users.ts` — `createUser`, `bulkImportUsers`
- `src/app/users/new/new-user-form.tsx` — label update ("Circle (optional)")
- `src/app/users/[id]/user-detail-client.tsx` — label update
- `src/app/users/import/bulk-import-form.tsx` — remove "circle required" validation, update column docs

---

## Decision 2: Optional Workspace Field — Schema Already Nullable

**Decision**: The `licenseAssignments.workspace` column is already defined as nullable in the schema (`varchar("workspace", { length: 200 })` without `.notNull()`). No DB migration is required. The only changes needed are in validators and the bulk import form/CSV parser.

**Rationale**: The DB schema permits NULL workspace already. The mandatory constraint exists only in the Zod `bulkImportAssignmentRowSchema` (`workspace: z.string().min(1).max(200)`) and the CSV parser's client-side validation (`if (!workspace) errors.push("Workspace is required")`). Removing `min(1)` and making the field optional at both layers is sufficient.

**Files affected**:
- `src/lib/validators.ts` — `bulkImportAssignmentRowSchema` workspace field
- `src/app/assignments/import/bulk-assignment-import-form.tsx` — remove "Workspace is required" client-side error, update column description
- `src/actions/assignments.ts` — `bulkImportAssignments`: workspace in the insert already passes through as-is; the type annotation in `validatedRows` needs updating

---

## Decision 3: Page-Size Selector — Augment Shared DataTable

**Decision**: Add a page-size selector directly into the shared `DataTable` component (`src/components/data-table.tsx`). Use TanStack Table's `setPagination` and `initialState.pagination.pageSize`. Render a shadcn `Select` component alongside the pagination buttons with options [10, 25, 50, 100].

**Rationale**: All four overview lists (users, assignments, tools, and the budget static table) use either the shared `DataTable` component or a plain `<Table>`. Centralising the change in `DataTable` propagates the page-size selector to all three TanStack-Table-powered lists in one change. The budget page (`/budget`) uses a raw `<Table>` — it must be handled separately (either converted to `DataTable` or given its own pagination controls, but given typically small record counts it may only need the quick-action buttons, not pagination).

**TanStack Table API**:
- `table.setPageSize(n)` — programmatically change page size
- `table.getState().pagination.pageSize` — read current size
- `initialState: { pagination: { pageSize: 10 } }` — default size

**Files affected**:
- `src/components/data-table.tsx` — add `pageSize` state, Select component in pagination row
- `src/app/budget/page.tsx` — add quick action links (no pagination needed given small dataset)

---

## Decision 4: Quick Action Buttons — Inline Pattern, Replace Dropdown

**Decision**: Replace the `DropdownMenu` / `MoreHorizontal` icon pattern (currently used in `UsersTable` and `ToolsTable`) with inline icon buttons directly in the row. Actions per list: Edit (navigate to detail/edit page) + View Details (same destination in most cases since detail page hosts the edit form) + a soft-delete action with `AlertDialog` confirmation. The `AssignmentsClient` already uses inline buttons and needs the Delete (Revoke) button added.

**Rationale**: The spec requires buttons that are "directly visible on the row" without additional clicks. The existing dropdown requires one click to reveal options. Using Lucide icon buttons (`Pencil`, `Eye`, `Trash2`) with `sr-only` labels satisfies WCAG keyboard-nav and screen-reader requirements (per constitution Principle IV).

**Soft-delete semantics by entity**:
| Entity | Button Label | Action | Effect |
|--------|-------------|--------|--------|
| User | Deactivate | `deactivateUser` | `status = inactive`, revokes all assignments |
| Assignment | Revoke | `revokeLicense` | `status = inactive`, sets `revokedAt` |
| Tool | Archive | `archiveTool` | `status = archived` (blocked if active assignments exist) |
| Budget | Archive | TBD (needs new action) | `status = archived` |

No hard-delete actions are appropriate given the FK constraints (`onDelete: "restrict"` on all major relationships). The button label on the overview should match existing terminology: "Deactivate", "Revoke", "Archive" — not a generic "Delete" label — to maintain UX consistency with detail-page patterns.

**AlertDialog** is already available at `src/components/ui/alert-dialog.tsx` and is already used in `tool-detail-client.tsx` and `user-detail-client.tsx`. The same component is used for the confirmation pattern.

**Files affected**:
- `src/app/users/users-table.tsx` — replace dropdown with inline Pencil/Eye/Trash2 buttons
- `src/app/tools/tools-table.tsx` — replace dropdown with inline Pencil/Eye/Trash2 buttons
- `src/app/assignments/assignments-client.tsx` — add Revoke icon button alongside existing Edit/View
- `src/app/budget/page.tsx` — add View + Archive inline buttons to budget list rows

---

## Decision 5: "None / Unassigned" Filter for Circle and Workspace

**Decision**: Add a "None / Unassigned" toggle/filter button above (or beside) the users and assignments overview lists, allowing admins to show only records with a null/empty circle or workspace. Implemented as a column filter using TanStack Table's custom `filterFn`.

**Rationale**: TanStack Table supports custom filter functions via `filterFn` on column definitions. For null-value filtering, define a custom `filterFn` (e.g., `"nullable-includes"`) that matches rows where the cell value is null/empty when the filter value is `"__none__"`. The filter UI is a `<Button variant="outline">` toggle that sets/unsets `columnFilters` for the circle/workspace column.

**Files affected**:
- `src/components/data-table.tsx` — expose `columnFilters` setter to parent or add filter-button slot prop
- `src/app/users/users-table.tsx` — add "No Circle" filter toggle for circle column
- `src/app/assignments/assignments-client.tsx` — add "No Workspace" filter toggle for workspace column

---

## Decision 6: Delete Action for Budget (new server action needed)

**Decision**: Add an `archiveBudget` server action to `src/actions/budget.ts` following the existing `archiveTool` pattern. Check for active status before archiving. This powers the Archive quick action on the budget overview list.

**Rationale**: No existing `archiveBudget` action was found. The budget schema has `budgetStatusEnum` with values `["active", "archived"]`, so the concept exists. The action follows identical patterns to `archiveTool`.

**Files affected**:
- `src/actions/budget.ts` — new `archiveBudget` action
