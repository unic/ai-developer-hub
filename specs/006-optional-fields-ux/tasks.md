# Tasks: Optional Fields & Overview UX Improvements

**Input**: Design documents from `/specs/006-optional-fields-ux/`
**Branch**: `006-optional-fields-ux`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Organization**: Tasks grouped by user story. Each story is independently testable after its phase completes.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no shared state)
- **[Story]**: User story this task belongs to (US1–US4)
- Exact file paths included in all descriptions

---

## Phase 1: Setup

**Purpose**: Establish a clean baseline before any changes are made.

- [X] T001 Run `pnpm typecheck` to confirm zero TypeScript errors on the current codebase; fix any pre-existing errors before proceeding

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared-file changes that US1 and US2 both depend on. MUST be complete before user story phases begin.

**WARNING**: T002 and T003 modify different files and can run in parallel. T004 MUST wait for T003.

- [X] T002 Update `src/lib/validators.ts` — make `bulkImportAssignmentRowSchema.workspace` optional (change `z.string().min(1).max(200)` to `z.string().max(200).optional()`); make `userSchema.circle` optional (`z.string().max(100).optional()`); make `bulkImportUserSchema.circle` optional (`z.string().max(100).optional()`); make `updateUserSchema.circle` nullable-optional (`z.string().max(100).optional().nullable()`)
- [X] T003 [P] Update `src/lib/db/schema.ts` — remove `.notNull()` from the `circle` column definition on the `users` table (line ~52); keep the `users_circle_idx` index unchanged
- [X] T004 Run `pnpm db:generate` to generate a Drizzle migration for the circle nullability change; inspect the generated SQL in `src/lib/db/migrations/` to verify it contains `ALTER TABLE "users" ALTER COLUMN "circle" DROP NOT NULL`

**Checkpoint**: Validators and schema are updated. Foundation is ready for all user stories.

---

## Phase 3: User Story 1 — Optional Workspace on License Assignment (Priority: P1)

**Goal**: Workspace field on the license assignment bulk import form becomes truly optional. Assignments can be created without a workspace value via bulk import or the existing create dialog.

**Independent Test**: Upload a CSV to `/assignments/import` with the workspace column absent or blank on every row — all rows should import successfully (previously they failed with "Workspace is required"). Verify imported assignments display "—" in the workspace column on the `/assignments` overview.

- [X] T005 [P] [US1] Update `src/actions/assignments.ts` — in `bulkImportAssignments`, change the `validatedRows` local array type so `workspace` is `string | undefined`; change the DB insert value to `workspace: workspace ?? null` (line ~449); update the destructured variable from `data` to include `workspace?: string`
- [X] T006 [P] [US1] Update `src/app/assignments/import/bulk-assignment-import-form.tsx` — remove `if (!workspace) errors.push("Workspace is required")` from `parseCSV`; change `ParsedAssignment.workspace` type from `string` to `string | undefined`; update the `CardDescription` text to list workspace as optional; update the CSV `handleImport` mapping so workspace is only included when non-empty
- [X] T007 [US1] Update `src/app/assignments/assignments-client.tsx` — add `showNoWorkspace` boolean state; add a "No Workspace" toggle `Button` (variant `"outline"`) above the `DataTable`; when active, pre-filter the `assignments` prop array to only rows where `workspace` is `null` or empty before passing to `DataTable`; when inactive, pass the full array

**Checkpoint**: US1 complete. Bulk assignment import works without workspace. `/assignments` shows a "No Workspace" filter toggle.

---

## Phase 4: User Story 2 — Optional Circle on User (Priority: P2)

**Goal**: Circle field on user creation, editing, and bulk import becomes truly optional. Users can be created/edited without a circle value.

**Independent Test**: Go to `/users/new`, leave the Circle field blank, submit — user should be created successfully. Go to `/users/import`, upload a CSV without a circle column — all rows should import. On `/users`, use the "No Circle" filter to verify users without a circle are shown.

- [X] T008 [US2] Update `src/actions/users.ts` — in `createUser`, change the DB insert to use `circle: circle ?? null`; in `bulkImportUsers`, change the DB insert to use `circle: circle ?? null`; ensure TypeScript infers `circle` as `string | undefined` from the updated Zod schema (depends on T002)
- [X] T009 [P] [US2] Update `src/app/users/new/new-user-form.tsx` — change the circle `FormLabel` text from "Circle" to "Circle (optional)"; remove the `defaultValues.circle: ""` initialisation (use `undefined` instead) so an empty field maps to `undefined` rather than an empty string
- [X] T010 [P] [US2] Update `src/app/users/[id]/user-detail-client.tsx` — change the circle `FormLabel` text to "Circle (optional)"; update the `defaultValues` for the circle field to use `tool.circle ?? ""` or `undefined` so the edit form handles `null` circle without a type error; ensure the submit handler sends `null` when the field is cleared
- [X] T011 [P] [US2] Update `src/app/users/import/bulk-import-form.tsx` — remove any "circle required" client-side validation from the field-mapping logic; update the CSV column description/help text to show circle as optional; ensure an empty circle cell in the CSV results in `undefined` (not an error)
- [X] T012 [US2] Update `src/app/users/users-table.tsx` — add null-safe render for the circle column cell: `cell: ({ row }) => row.getValue("circle") || "\u2014"`; add `showNoCircle` boolean state; add a "No Circle" toggle `Button` (variant `"outline"`) rendered above the `DataTable`; when active, pre-filter the `data` prop to only users where `circle` is `null` or empty before passing to `DataTable`; when inactive, pass full data

**Checkpoint**: US2 complete. Users can be created/edited/imported without a circle. `/users` shows a "No Circle" filter toggle and displays "—" for users with no circle.

---

## Phase 5: User Story 3 — Configurable Page Size in Overview Lists (Priority: P3)

**Goal**: All three DataTable-powered overview lists (users, assignments, tools) gain a page-size selector. Users can switch between 10 (default), 25, 50, and 100 rows per page.

**Independent Test**: Go to `/users` — the pagination row should show a `Select` dropdown alongside the Previous/Next buttons. Select "25" — up to 25 rows are displayed and the list resets to page 1. Test the same on `/assignments` and `/tools`.

- [X] T013 [US3] Update `src/components/data-table.tsx` — add `pagination` state (`useState({ pageIndex: 0, pageSize: 10 })`); wire `onPaginationChange` and `state.pagination` on the `useReactTable` call (replacing the implicit pagination defaults); in the pagination `div`, add a shadcn `Select` component before the Previous/Next buttons with `SelectItem` values for `"10"`, `"25"`, `"50"`, `"100"`; on change, call `table.setPageSize(Number(value))` which resets to page 1 automatically via TanStack Table; add `import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"`

**Checkpoint**: US3 complete. Page-size selector appears on all three DataTable-powered lists.

---

## Phase 6: User Story 4 — Quick Action Buttons in Overview Lists (Priority: P4)

**Goal**: Every overview list row shows inline quick action buttons (View, Edit, and a soft-delete action) without requiring a dropdown click. Delete actions show a confirmation dialog before executing.

**Independent Test**: On `/users` (admin), each row should show three visible icon buttons. Clicking the Deactivate button should show a confirmation dialog; confirming should deactivate the user. Test the same pattern on `/tools` (Archive) and `/assignments` (Revoke). On `/budget`, budget rows should show View and Archive buttons.

- [X] T014 [US4] Add `archiveBudget` server action to `src/actions/budget.ts` — require admin auth; load budget by ID; return error if not found or already archived; set `status = "archived"` and `updatedAt = new Date()`; call `recordStatusChange("budget", id, adminId, "active", "archived")`; call `revalidatePath("/budget")`; return `ActionResult<void>`
- [X] T015 [P] [US4] Update `src/app/users/users-table.tsx` — remove `DropdownMenu`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuTrigger`, `MoreHorizontal` imports; add `Eye`, `Pencil`, `UserX` from lucide-react and `AlertDialog`, `AlertDialogAction`, `AlertDialogCancel`, `AlertDialogContent`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogHeader`, `AlertDialogTitle`, `AlertDialogTrigger` from `@/components/ui/alert-dialog`; import `deactivateUser` from `@/actions/users` and `useRouter` from `next/navigation`; replace the dropdown actions cell with three inline icon `Button` elements: (1) `Eye` linked to `/users/[id]` (visible to all), (2) `Pencil` linked to `/users/[id]` (admin only), (3) `UserX` inside `AlertDialog` that calls `deactivateUser({ id })` on confirm (admin only, disabled if `status !== "active"`); make `UsersTable` a `"use client"` component accepting `isAdmin` prop
- [X] T016 [P] [US4] Update `src/app/tools/tools-table.tsx` — same pattern as T015: remove dropdown; add `Eye`, `Pencil`, `Archive` icons + `AlertDialog` imports; import `archiveTool` from `@/actions/tools`; replace actions column with three inline buttons: (1) `Eye` → `/tools/[id]`, (2) `Pencil` → `/tools/[id]`, (3) `Archive` inside `AlertDialog` calling `archiveTool({ id })` on confirm (disabled if `row.original.activeLicenses > 0`, with dialog description explaining why when disabled); the component needs `activeLicenses` count per row — it already exists as `ToolRow.activeLicenses`
- [X] T017 [US4] Update `src/app/assignments/assignments-client.tsx` — add `Ban` icon from lucide-react; add `AlertDialog` component imports; in the actions column cell, add a `Ban` icon button (Revoke) inside an `AlertDialog` confirmation dialog, calling `handleRevoke(row.original.id)` on confirm; show only when `isAdmin && row.original.status === "active"` (consistent with existing Edit button visibility); this task builds on T007 changes to this file
- [X] T018 [US4] Update `src/app/budget/page.tsx` — convert to a client component (`"use client"`) or extract the budget list into a separate `BudgetList` client component; import `archiveBudget` from `@/actions/budget`; import `Eye`, `Archive` icons, `Button`, `AlertDialog` components, and `useRouter`; in the budget list table rows, replace the existing `<Button asChild variant="ghost" size="sm"><Link href={...}>View</Link></Button>` with two inline buttons: (1) `Eye` linked to `/budget/[id]`, (2) `Archive` icon inside `AlertDialog` calling `archiveBudget({ id })` on confirm (hidden for already-archived budgets); call `router.refresh()` after successful archive

**Checkpoint**: US4 complete. All four overview lists have inline quick action buttons. Soft-delete actions show confirmation dialogs.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, null-safety cleanup, and TypeScript compilation check.

- [X] T019 [P] Run `pnpm typecheck` — resolve any TypeScript errors introduced by the `circle: string | null` type change propagating through the codebase (e.g., any component that calls `user.circle.toLowerCase()` or renders `user.circle` directly without null guard)
- [X] T020 [P] Run `pnpm lint` — fix any ESLint warnings introduced by the changes (unused imports from removed dropdown menus, etc.)
- [ ] T021 Run `pnpm db:migrate` against the dev database to apply the circle nullability migration; verify with `pnpm db:seed` that seeded users still work correctly
- [ ] T022 Manual smoke test per `specs/006-optional-fields-ux/quickstart.md` — verify all four user stories work end-to-end in the running dev server (`pnpm dev`)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user story phases
- **US1 (Phase 3)**: Depends on Phase 2 (validators updated) — independent of US2/US3/US4
- **US2 (Phase 4)**: Depends on Phase 2 (validators + schema updated) — independent of US1/US3/US4
- **US3 (Phase 5)**: Depends on Phase 2 — independent of US1/US2/US4
- **US4 (Phase 6)**: Depends on Phase 2 and Phase 3 (T007 modifies assignments-client.tsx); US4 T015 also builds on US2 T012 for users-table.tsx
- **Polish (Phase 7)**: Depends on all story phases

### User Story Dependencies

- **US1 (P1)**: No dependencies on other stories. Can start immediately after Foundational.
- **US2 (P2)**: No dependencies on other stories. Can start immediately after Foundational.
- **US3 (P3)**: No dependencies on other stories. Can start immediately after Foundational.
- **US4 (P4)**: T017 builds on T007 (same file: assignments-client.tsx). T015 builds on T012 (same file: users-table.tsx). Both modifications are additive.

### Same-File Edit Order

| File | Story Order |
|------|-------------|
| `src/lib/validators.ts` | T002 (Foundational) only |
| `src/app/assignments/assignments-client.tsx` | T007 (US1) → T017 (US4) |
| `src/app/users/users-table.tsx` | T012 (US2) → T015 (US4) |
| `src/components/data-table.tsx` | T013 (US3) only |

### Parallel Opportunities

Within Phase 2: T002 and T003 (different files)
Within Phase 3: T005 and T006 (different files)
Within Phase 4: T009, T010, T011 (all different files)
Within Phase 6: T015 and T016 (different files)
Within Phase 7: T019 and T020 (different commands)

---

## Parallel Example: Phase 4 (US2)

```
After T008 completes, launch simultaneously:
  Task A: "Update new-user-form.tsx — circle label → optional" (T009)
  Task B: "Update user-detail-client.tsx — circle edit form null handling" (T010)
  Task C: "Update bulk-import-form.tsx — remove circle required check" (T011)
Then sequentially:
  Task D: "Update users-table.tsx — null-safe circle + No Circle filter" (T012)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001)
2. Complete Phase 2: Foundational (T002–T004)
3. Complete Phase 3: US1 — Optional Workspace (T005–T007)
4. **STOP and VALIDATE**: Upload a workspace-less CSV to `/assignments/import` — confirm import succeeds
5. Deploy/demo if ready

### Incremental Delivery

1. Foundational → US1 → test → deploy (workspace optional)
2. + US2 → test → deploy (circle optional + No Circle filter)
3. + US3 → test → deploy (page-size selector on all lists)
4. + US4 → test → deploy (quick action buttons everywhere)

### Parallel Team Strategy

After Foundational completes:
- Developer A: US1 (assignments bulk import + No Workspace filter)
- Developer B: US2 (users schema + forms + No Circle filter)
- Developer C: US3 (DataTable page-size selector)
- Developer D starts US4 after US1 and US2 are done (shares files)

---

## Notes

- `[P]` tasks touch different files with no shared state — safe to run concurrently
- Each user story phase ends with an independently testable checkpoint
- US4 T015 (users-table) and US2 T012 (users-table) modify the same file — execute T012 first
- US4 T017 (assignments) and US1 T007 (assignments) modify the same file — execute T007 first
- After T003 (schema change), run T004 (`db:generate`) before starting US2 form changes
- All soft-delete actions (Deactivate / Revoke / Archive) follow the existing pattern in `tool-detail-client.tsx` using `AlertDialog`
- No new npm packages required — all components already installed
