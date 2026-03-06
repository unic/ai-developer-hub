# Tasks: Better Tables

**Input**: Design documents from `/specs/012-better-tables/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Not explicitly requested in spec. Test tasks omitted.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the reusable shared components that multiple user stories depend on

- [ ] T001 [P] Create DataTableColumnHeader component with three-state sort cycling (unsorted/asc/desc) and directional icons (ArrowUpDown/ArrowUp/ArrowDown) per contracts in `src/components/data-table-column-header.tsx`
- [ ] T002 [P] Enhance DataTable component: wrap output in TooltipProvider, add `facetedFilters` prop support to render filter toolbar between search and table in `src/components/data-table.tsx`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Migrate the two plain HTML tables to the shared DataTable component so all 5 tables can receive sorting, tooltips, and overflow menus uniformly

**CRITICAL**: No user story work can begin until this phase is complete

- [ ] T003 Create Invoices client table component: extract table rendering from server page into new client component with TanStack Table column definitions (Invoice Number, Date, Amount, Vendor, Budget Period, Uploaded By, Download action) in `src/app/invoices/invoices-table.tsx`
- [ ] T004 Refactor Invoices page to delegate table rendering to the new InvoicesTable client component, keeping data fetching in the server component in `src/app/invoices/page.tsx`
- [ ] T005 Create Budget list client table component: extract table rendering from server page into new client component with TanStack Table column definitions (Fiscal Year, Planned Amount, Status, Actions) in `src/app/budget/budget-table.tsx`
- [ ] T006 Refactor Budget list page to delegate table rendering to the new BudgetTable client component, keeping data fetching and summary cards in the server component in `src/app/budget/page.tsx`

**Checkpoint**: All 5 tables now use the shared DataTable component. Sorting, tooltips, and overflow menus can be applied uniformly.

---

## Phase 3: User Story 1 - Column Sorting Across All Tables (Priority: P1) MVP

**Goal**: Every data column on every table supports click-to-sort with ascending/descending/unsorted cycling and visual direction indicators.

**Independent Test**: Click any column header on any table page (/tools, /users, /assignments, /invoices, /budget) and verify data reorders. Click again to reverse. Click a third time to clear sort.

### Implementation for User Story 1

- [ ] T007 [P] [US1] Update Tools table columns: replace inline sort buttons on Name and Vendor with DataTableColumnHeader, add DataTableColumnHeader to Active Licenses and Status columns in `src/app/tools/tools-table.tsx`
- [ ] T008 [P] [US1] Update Users table columns: replace inline sort buttons on Name and Circle with DataTableColumnHeader, add DataTableColumnHeader to Email, Role, Profile, and Status columns in `src/app/users/users-table.tsx`
- [ ] T009 [P] [US1] Update Assignments table columns: add DataTableColumnHeader to all data columns (User, Tool, Tier, Monthly Cost, Status, Workspace, Assigned) in `src/app/assignments/assignments-client.tsx`
- [ ] T010 [P] [US1] Add DataTableColumnHeader to all Invoices table column definitions (Invoice Number, Date, Amount, Vendor, Budget Period, Uploaded By) in `src/app/invoices/invoices-table.tsx`
- [ ] T011 [P] [US1] Add DataTableColumnHeader to all Budget list table column definitions (Fiscal Year, Planned Amount, Status) in `src/app/budget/budget-table.tsx`

**Checkpoint**: All 5 tables have sortable columns. US1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - Unified Quick Actions with Consistent Icons, Tooltips, and Labels (Priority: P1)

**Goal**: Every row action button across all tables uses the same icon for the same action type, displays a tooltip on hover, and has an accessible aria-label in the format "Action ItemName".

**Independent Test**: Navigate to each table page, hover over View/Edit buttons to verify tooltip appears with correct text. Use browser accessibility inspector to verify aria-label on each button. Confirm Assignments View action uses Eye icon (not text button).

### Implementation for User Story 2

- [ ] T012 [P] [US2] Update Tools table actions column: wrap View (Eye) and Edit (Pencil) buttons in Tooltip, add aria-label="View {toolName}" / "Edit {toolName}" in `src/app/tools/tools-table.tsx`
- [ ] T013 [P] [US2] Update Users table actions column: wrap View (Eye) and Edit (Pencil) buttons in Tooltip, add aria-label="View {userName}" / "Edit {userName}" in `src/app/users/users-table.tsx`
- [ ] T014 [P] [US2] Update Assignments table actions column: replace text-based View link with Eye icon button wrapped in Tooltip, wrap Edit (Pencil) button in Tooltip, add aria-labels in `src/app/assignments/assignments-client.tsx`
- [ ] T015 [P] [US2] Add Tooltip with aria-label to Download (Download icon) action button in Invoices table in `src/app/invoices/invoices-table.tsx`
- [ ] T016 [P] [US2] Add Tooltip with aria-label to View (Eye) action button in Budget list table in `src/app/budget/budget-table.tsx`

**Checkpoint**: All action buttons have tooltips and accessible labels. US2 is fully functional and testable independently.

---

## Phase 5: User Story 3 - Destructive Actions Hidden Behind Overflow Menu (Priority: P2)

**Goal**: All destructive actions (Archive, Deactivate, Revoke, Delete) are moved from direct icon buttons into a three-dot DropdownMenu. Menu items use `variant="destructive"`. Selecting a menu item opens the existing AlertDialog confirmation. The overflow menu only renders for users with permission for at least one destructive action on that row.

**Independent Test**: On each table, verify destructive actions are no longer visible as direct buttons. Click the three-dot menu to see destructive options. Confirm selecting a destructive option still shows the AlertDialog. As a non-admin, verify no three-dot menu appears.

### Implementation for User Story 3

- [ ] T017 [P] [US3] Refactor Tools table actions: move Archive action from AlertDialogTrigger button into DropdownMenu with MoreHorizontal trigger, use state to control AlertDialog open/close, add Tooltip to overflow menu trigger, only render menu when isAdmin and status is active in `src/app/tools/tools-table.tsx`
- [ ] T018 [P] [US3] Refactor Users table actions: move Deactivate action from AlertDialogTrigger button into DropdownMenu with MoreHorizontal trigger, use state to control AlertDialog, add Tooltip to overflow trigger, only render when isAdmin and user is active in `src/app/users/users-table.tsx`
- [ ] T019 [P] [US3] Refactor Assignments table actions: move Revoke action from AlertDialogTrigger button into DropdownMenu with MoreHorizontal trigger, use state to control AlertDialog, add Tooltip to overflow trigger, only render when isAdmin and assignment is active in `src/app/assignments/assignments-client.tsx`
- [ ] T020 [US3] Refactor Budget list actions: move Archive action into DropdownMenu with MoreHorizontal trigger inside the BudgetTable actions column, use state to control AlertDialog, add Tooltip to overflow trigger, only render when budget is not archived in `src/app/budget/budget-table.tsx` and `src/app/budget/budget-list-actions.tsx`

**Checkpoint**: All destructive actions are behind overflow menus. US3 is fully functional and testable independently.

---

## Phase 6: User Story 4 - Column Filtering on Key Columns (Priority: P3)

**Goal**: Categorical columns display faceted filter buttons in the DataTable toolbar. Users can multi-select filter values to narrow displayed rows. Filters work alongside global search.

**Independent Test**: On the Tools table, use the Status filter to select "Active" — only active tools shown. On Users, filter by Role "Admin" — only admins shown. Apply a filter and use global search simultaneously — both apply (intersection). Clear filter — all rows return.

### Implementation for User Story 4

- [ ] T021 Create DataTableFacetedFilter component: popover with checkbox list, multi-select, badge count display, clear action, per contracts in `src/components/data-table-faceted-filter.tsx`
- [ ] T022 [P] [US4] Add facetedFilters prop to Tools table DataTable: Status column with options Active, Archived in `src/app/tools/tools-table.tsx`
- [ ] T023 [P] [US4] Add facetedFilters prop to Users table DataTable: Role column (Admin, Viewer) and Status column (Active, Inactive) in `src/app/users/users-table.tsx`
- [ ] T024 [P] [US4] Add facetedFilters prop to Assignments table DataTable: Status column with options Active, Revoked in `src/app/assignments/assignments-client.tsx`
- [ ] T025 [P] [US4] Add facetedFilters prop to Budget list table DataTable: Status column with options Active, Archived in `src/app/budget/budget-table.tsx`

**Checkpoint**: All categorical columns have faceted filters. US4 is fully functional and testable independently.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final verification, edge case handling, and cleanup

- [ ] T026 Verify edge case: null/empty values sort to end regardless of sort direction across all tables — add custom sort comparators if needed in `src/components/data-table-column-header.tsx`
- [ ] T027 Verify edge case: non-admin users see clean actions column with no empty space where admin actions would be — adjust conditional rendering if needed across all table files
- [ ] T028 Run `pnpm typecheck` and `pnpm lint` — fix any TypeScript or ESLint issues introduced
- [ ] T029 Run `pnpm build` — verify production build succeeds with no errors
- [ ] T030 Manual smoke test: verify all 5 tables on /tools, /users, /assignments, /invoices, /budget for sorting, tooltips, overflow menus, and filters

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on T002 (DataTable enhancement) for TooltipProvider — BLOCKS all user stories
- **US1 Sorting (Phase 3)**: Depends on T001 (DataTableColumnHeader) and Phase 2 (table migrations)
- **US2 Quick Actions (Phase 4)**: Depends on T002 (TooltipProvider in DataTable) and Phase 2 (table migrations)
- **US3 Overflow Menu (Phase 5)**: Depends on Phase 2 (table migrations). Can run in parallel with US1 and US2.
- **US4 Filtering (Phase 6)**: Depends on T021 (DataTableFacetedFilter) and T002 (DataTable facetedFilters prop)
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: Depends on Phase 1 + Phase 2. No dependencies on other stories.
- **US2 (P1)**: Depends on Phase 1 + Phase 2. No dependencies on other stories. Can run in parallel with US1.
- **US3 (P2)**: Depends on Phase 2. No dependencies on US1 or US2. Can run in parallel.
- **US4 (P3)**: Depends on Phase 1 + Phase 2 + T021. No dependencies on US1-US3. Can run in parallel.

### Within Each User Story

All tasks within US1, US2, US3, and US4 are marked [P] (parallelizable) since they modify different files with no cross-dependencies.

### Parallel Opportunities

- T001 and T002 can run in parallel (different files)
- T003+T004 and T005+T006 can run in parallel (different page migrations)
- All US1 tasks (T007-T011) can run in parallel
- All US2 tasks (T012-T016) can run in parallel
- All US3 tasks (T017-T020) can run in parallel
- T022-T025 can run in parallel (after T021 completes)

---

## Parallel Example: User Story 1

```bash
# After Phase 1 + Phase 2 complete, launch all US1 tasks in parallel:
Task T007: "Update Tools table columns with DataTableColumnHeader in src/app/tools/tools-table.tsx"
Task T008: "Update Users table columns with DataTableColumnHeader in src/app/users/users-table.tsx"
Task T009: "Update Assignments table columns with DataTableColumnHeader in src/app/assignments/assignments-client.tsx"
Task T010: "Add DataTableColumnHeader to Invoices table in src/app/invoices/invoices-table.tsx"
Task T011: "Add DataTableColumnHeader to Budget table in src/app/budget/budget-table.tsx"
```

## Parallel Example: User Story 2

```bash
# After Phase 1 + Phase 2 complete, launch all US2 tasks in parallel:
Task T012: "Add tooltips and aria-labels to Tools table actions in src/app/tools/tools-table.tsx"
Task T013: "Add tooltips and aria-labels to Users table actions in src/app/users/users-table.tsx"
Task T014: "Add tooltips and aria-labels to Assignments table actions in src/app/assignments/assignments-client.tsx"
Task T015: "Add tooltips and aria-labels to Invoices table actions in src/app/invoices/invoices-table.tsx"
Task T016: "Add tooltips and aria-labels to Budget table actions in src/app/budget/budget-table.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001, T002)
2. Complete Phase 2: Foundational (T003-T006)
3. Complete Phase 3: User Story 1 — Sorting (T007-T011)
4. **STOP and VALIDATE**: Click column headers on all 5 tables, verify sorting works
5. Deploy/demo if ready

### Incremental Delivery

1. Phase 1 + Phase 2 → Foundation ready (all tables on DataTable)
2. Add US1 (Sorting) → Test → Deploy/Demo (MVP!)
3. Add US2 (Tooltips + Consistent Icons) → Test → Deploy/Demo
4. Add US3 (Overflow Menus) → Test → Deploy/Demo
5. Add US4 (Faceted Filters) → Test → Deploy/Demo
6. Polish → Final validation → Deploy

### Parallel Strategy

Since US1-US4 modify the same files (each table's component), the safest approach is sequential by user story. However, within each story, all 5 table modifications can run in parallel. US1 and US2 can also be combined into a single pass per table file if preferred.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- Commit after each task or logical group (e.g., after each phase, or after each table file update)
- No database migrations needed — this is a UI-only feature
- No new npm dependencies needed — all components already available
