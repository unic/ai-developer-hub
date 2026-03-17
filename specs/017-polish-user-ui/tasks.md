# Tasks: Polish User & License UI

**Input**: Design documents from `/specs/017-polish-user-ui/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, quickstart.md

**Tests**: Not explicitly requested — test tasks are omitted.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/` at repository root (Next.js App Router)

---

## Phase 1: Setup

**Purpose**: No project initialization needed — existing codebase. This phase is empty.

---

## Phase 2: Foundational (Shared Components)

**Purpose**: Create reusable components needed by multiple user stories

- [x] T001 Create `EditUserDialog` component with React Hook Form + Zod validation (updateUserSchema) in `src/components/edit-user-dialog.tsx` — Dialog with fields: name, email, circle, role, profile, GitHub username. Follow `EditAssignmentDialog` pattern from `src/app/assignments/assignments-client.tsx`. Props: `user` data, `open`/`onOpenChange` state, `onSaved` callback.
- [x] T002 Create `UserCombobox` component in `src/components/user-combobox.tsx` — Searchable single-select using Popover + Command (cmdk) pattern. Props: `users` list, `value` (selected userId), `onSelect` callback. Display format: `{name} ({email})`. Client-side filtering over pre-loaded data. Include "No users found" empty state.

**Checkpoint**: Shared components ready — user story implementation can begin

---

## Phase 3: User Story 1 — Inline Edit User from Overview (Priority: P1) 🎯 MVP

**Goal**: Replace the duplicate edit link with a dialog that opens inline from the user overview table

**Independent Test**: Click "Edit" on a user row → dialog opens with pre-populated fields → modify and save → table row updates without page navigation

### Implementation for User Story 1

- [x] T003 [US1] Modify `src/app/users/users-table.tsx` — Import `EditUserDialog` (T001). Add state for `editingUser` and `editDialogOpen`. In `UserRowActions`, replace the edit `<Link>` with a `<Button>` that sets `editingUser` and opens the dialog. Keep the "View" link unchanged. Render `EditUserDialog` at the table level, controlled by the state. On save callback, call `router.refresh()` to update table data. Only show edit button for admin users and active users.

**Checkpoint**: User Story 1 complete — admins can edit users inline from overview without navigating away

---

## Phase 4: User Story 2 — Unified Filters on User Overview (Priority: P1)

**Goal**: Replace the standalone "No Circle" toggle with faceted filters for Circle, Role, Status, and Profile — all visually consistent

**Independent Test**: All four filters appear as faceted filters with the same style. Selecting circle/profile values correctly filters the table. "No Circle" and "No Profile" sentinel options work.

### Implementation for User Story 2

- [x] T004 [US2] Modify `src/app/users/users-table.tsx` — Remove the `showNoCircle` state, the pre-filtering `useMemo`, and the toggle button UI. Add `circle` and `profile` columns to the column definitions with `filterFn: arrayIncludesFilterFn`. For the `circle` column accessor, map `null`/`undefined` to a sentinel value `"__no_circle__"`. For the `profile` column accessor, map `null`/`undefined` to `"__no_profile__"`. Create dynamic `USERS_FACETED_FILTERS` via `useMemo` that extracts unique circle values from data (like `tools-table.tsx` vendor pattern), adds `{ label: "No Circle", value: "__no_circle__" }`, and includes static Profile options (Boost, Maxed, Indie, No Profile). Keep existing Role and Status filters. Pass the combined filters to `DataTable`. The circle and profile columns can be hidden from the table display if desired (set `enableHiding: true` or use column visibility).

**Checkpoint**: User Story 2 complete — all filters are visually unified faceted filters

---

## Phase 5: User Story 3 — Complete Add User Form (Priority: P1)

**Goal**: Enhance the existing `/users/new` form to include all fields that the edit form has

**Independent Test**: Navigate to `/users/new` → all fields present (name, email, password, circle, role, profile, GitHub username) → create user → all fields saved correctly

### Implementation for User Story 3

- [x] T005 [US3] Modify `src/app/users/new/new-user-form.tsx` — Verify that all fields are present: name, email, password, circle, role, profile, and GitHub username. The existing form already includes most fields based on `userSchema`. Ensure the Profile select field is present with options None/Boost/Maxed/Indie (matching the edit form on user detail page). Ensure the GitHub Username field is present. Verify field order and styling matches the edit form pattern for consistency. If any fields are missing, add them following the existing form field pattern.

**Checkpoint**: User Story 3 complete — add user form has full field parity with edit form

---

## Phase 6: User Story 4 — Assign License from User Detail (Priority: P2)

**Goal**: Add an "Assign License" button on the user detail page that opens a dialog pre-filled with the current user

**Independent Test**: Navigate to active user detail → click "Assign License" → select tool and tier → confirm → license appears in assigned tools list

### Implementation for User Story 4

- [x] T006 [US4] Modify `src/app/users/[id]/user-detail-client.tsx` — Add an "Assign License" button (Plus icon, admin-only, active users only) in the "Assigned Tools" card header. Add state for `assignDialogOpen`. Create an inline assign-license dialog (or extract from `assignments-client.tsx`) with: tool select (loads active tools), tier select (loads tiers for selected tool via `getToolWithTiers`), and a confirm button. The userId is pre-set (current user) — no user selection needed. On confirm, call `assignLicense({ userId, toolId, tierId })` server action. On success, show toast and call `router.refresh()`. Import necessary server actions: `assignLicense` from `src/actions/assignments.ts`, `getTools` and `getToolWithTiers` for the dropdowns.

**Checkpoint**: User Story 4 complete — admins can assign licenses directly from user detail

---

## Phase 7: User Story 5 — Reactivate Revoked License from User Detail (Priority: P2)

**Goal**: Add a "Reactivate" button on revoked license rows in the user detail page

**Independent Test**: View user with revoked license → click "Reactivate" → confirmation dialog → confirm → new active assignment created

### Implementation for User Story 5

- [x] T007 [US5] Modify `src/app/users/[id]/user-detail-client.tsx` — In the assigned tools list, for each revoked (inactive) assignment where the tool is still active, add a "Reactivate" button (RotateCcw icon, admin-only). On click, show an `AlertDialog` confirmation with tool name, tier name, and current tier cost. On confirm, call `assignLicense({ userId: user.id, toolId: assignment.toolId, tierId: assignment.tierId })`. Handle capacity errors gracefully (show error toast if tool is at max capacity). On success, show toast and `router.refresh()`. Check if the tool is still active before showing the button (tool status === "active"). If the tier is no longer active, show a disabled state or hide the button.

**Checkpoint**: User Story 5 complete — admins can reactivate revoked licenses with one click

---

## Phase 8: User Story 6 — Unified Filters on License Assignments Overview (Priority: P2)

**Goal**: Add Tool, Tier, and Workspace faceted filters alongside existing Status and Source filters

**Independent Test**: All five filters appear as faceted filters. Selecting a tool/tier/workspace correctly narrows the assignment list. "No Workspace" option works.

### Implementation for User Story 6

- [x] T008 [US6] Modify `src/app/assignments/assignments-client.tsx` — Remove the `showNoWorkspace` state, pre-filtering useMemo, and toggle button (same pattern as circle toggle removal in T004). Add `toolName`, `tierName`, and `workspace` to column definitions with `filterFn: arrayIncludesFilterFn`. For `workspace`, map null/undefined to `"__no_workspace__"` sentinel. Create dynamic faceted filters via `useMemo`: extract unique tool names, tier names, and workspace values from loaded data. Add `{ label: "No Workspace", value: "__no_workspace__" }` to workspace options. Keep existing Status and Source filters. Pass combined filters array to `DataTable`.

**Checkpoint**: User Story 6 complete — all assignment filters are unified faceted filters

---

## Phase 9: User Story 7 — Searchable User Selection in Assign License Dialog (Priority: P2)

**Goal**: Replace the plain user `<Select>` in the assign-license dialog with the searchable `UserCombobox`

**Independent Test**: Open assign-license dialog → type partial name → filtered results appear → select user → assignment flow continues

### Implementation for User Story 7

- [x] T009 [US7] Modify `src/app/assignments/assignments-client.tsx` — In the assign-license dialog section, replace the user `<Select>` component with `UserCombobox` (T002). Pass the `activeUsers` list as the `users` prop. Set `value` to `selectedUserId` state. Set `onSelect` to update `selectedUserId`. Ensure the combobox styling fits within the dialog layout. Remove the old Select import if no longer used for user selection.

**Checkpoint**: User Story 7 complete — admins can search for users by name/email when assigning licenses

---

## Phase 10: User Story 8 — Editable License Assignment Detail Fields (Priority: P3)

**Goal**: Refactor assignment detail editing to use React Hook Form inline-edit pattern matching user detail page

**Independent Test**: Navigate to active assignment detail → fields use consistent edit pattern → edit workspace → save → change persists in history

### Implementation for User Story 8

- [x] T010 [US8] Modify `src/app/assignments/[id]/assignment-detail-client.tsx` — Refactor the editing section to use React Hook Form with `updateAssignmentSchema` (Zod resolver). Replace individual `useState` fields (showApiKeyInput, apiKeyInput, etc.) with a single form instance. Create an "Edit Assignment" card form (matching the user detail "Edit User" card pattern) with fields: tier (select), assigned date (date picker), workspace (text input), API key (password input with reveal/copy). Add "Save Changes" button that calls `updateAssignment` server action. Keep API key reveal/copy as supplementary actions outside the form. Show the form only for admins viewing active assignments. On save, show toast and `router.refresh()`.

**Checkpoint**: User Story 8 complete — assignment detail editing is consistent with user detail page

---

## Phase 11: User Story 9 — Navigate to User from Assignment Detail (Priority: P3)

**Goal**: Make the user name on the assignment detail page a clickable link to the user's detail page

**Independent Test**: View assignment detail → user name is a link → click → navigates to correct user detail page

### Implementation for User Story 9

- [x] T011 [US9] Modify `src/app/assignments/[id]/assignment-detail-client.tsx` — Find where the assigned user's name is displayed (in the assignment detail header or info section). Wrap the user name text in a Next.js `<Link>` component pointing to `/users/${assignment.userId}`. Style the link with underline or primary color to indicate it's clickable. Import `Link` from `next/link` if not already imported.

**Checkpoint**: User Story 9 complete — one-click navigation from assignment to user detail

---

## Phase 12: User Story 10 — Claude Console Integration Section in Settings (Priority: P3)

**Goal**: Create a dedicated Claude Console section in settings/integrations and move the bulk sync button there

**Independent Test**: Navigate to Settings > Integrations → Claude Console section visible with sync button and status → sync works → users page no longer has sync button

### Implementation for User Story 10

- [x] T012 [P] [US10] Create `ClaudeSyncSection` component in `src/components/claude-sync-section.tsx` — Follow `CopilotSyncSection` pattern from `src/components/copilot/copilot-sync-section.tsx`. Display: section title "Claude Console", description, "Sync All Costs" button, last sync status (lastSyncCompletedAt, lastSyncError from anthropicSyncStatus), synced days count. Use `syncAllAnthropicUsage` server action for the sync button. Show spinner during sync (RefreshCw + animate-spin). Show toast with results (synced users, errors). Accept initial sync status as props (fetched by parent server component).
- [x] T013 [P] [US10] Modify `src/app/settings/integrations/page.tsx` — Import `ClaudeSyncSection`. Fetch Anthropic sync status data (query `anthropicSyncStatus` table for userId=0 global record) alongside existing GitHub/Copilot data. Render `ClaudeSyncSection` below the existing Copilot section, passing sync status as props.
- [x] T014 [US10] Modify `src/app/users/page.tsx` — Remove the `SyncAllButton` import and its rendering from the action buttons area. The sync functionality now lives in settings. Optionally delete `src/app/users/sync-all-button.tsx` if it's no longer imported anywhere.

**Checkpoint**: User Story 10 complete — Claude sync is in settings, removed from users page

---

## Phase 13: Polish & Cross-Cutting Concerns

**Purpose**: Verify consistency and cleanup

- [x] T015 Run `pnpm typecheck` to verify no TypeScript errors across all changes
- [x] T016 Run `pnpm lint` to verify no ESLint warnings
- [x] T017 Run `pnpm build` to verify production build succeeds
- [x] T018 Verify all sentinel filter values (`__no_circle__`, `__no_profile__`, `__no_workspace__`) are consistent and don't leak into the UI display

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Empty — existing project
- **Foundational (Phase 2)**: T001, T002 — shared components. BLOCKS stories that use them.
- **User Stories (Phase 3-12)**: Depend on Phase 2 completion for T001/T002, but most are independent of each other
- **Polish (Phase 13)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: Depends on T001 (EditUserDialog) → T003
- **US2 (P1)**: No component dependencies → T004 (independent)
- **US3 (P1)**: No component dependencies → T005 (independent)
- **US4 (P2)**: No component dependencies → T006 (independent, reuses existing server actions)
- **US5 (P2)**: No component dependencies → T007 (independent, modifies same file as T006)
- **US6 (P2)**: No component dependencies → T008 (independent)
- **US7 (P2)**: Depends on T002 (UserCombobox) → T009
- **US8 (P3)**: No component dependencies → T010 (independent)
- **US9 (P3)**: No component dependencies → T011 (independent, modifies same file as T010)
- **US10 (P3)**: T012 + T013 parallel, then T014 → independent of all other stories

### File Conflict Awareness

- `users-table.tsx`: T003 (US1) and T004 (US2) both modify this file — execute sequentially
- `user-detail-client.tsx`: T006 (US4) and T007 (US5) both modify this file — execute sequentially
- `assignment-detail-client.tsx`: T010 (US8) and T011 (US9) both modify this file — execute sequentially
- `assignments-client.tsx`: T008 (US6) and T009 (US7) both modify this file — execute sequentially

### Parallel Opportunities

- T001 and T002 can run in parallel (different new files)
- T004 (US2) and T005 (US3) can run in parallel (different files)
- T006 (US4) and T008 (US6) can run in parallel (different files)
- T010 (US8) and T012+T013 (US10) can run in parallel (different files)
- T012 and T013 can run in parallel within US10

---

## Parallel Example: Foundational Phase

```text
# Launch both shared components in parallel:
Task T001: "Create EditUserDialog in src/components/edit-user-dialog.tsx"
Task T002: "Create UserCombobox in src/components/user-combobox.tsx"
```

## Parallel Example: P1 Stories (after foundational)

```text
# After T001 completes, US1 can start. US2 and US3 can start immediately:
Task T003 [US1]: "Modify users-table.tsx — integrate EditUserDialog"
Task T005 [US3]: "Modify new-user-form.tsx — verify all fields" (parallel with T003)

# T004 [US2] must wait for T003 to complete (same file: users-table.tsx)
Task T004 [US2]: "Modify users-table.tsx — unified faceted filters"
```

---

## Implementation Strategy

### MVP First (User Stories 1-3, P1 only)

1. Complete Phase 2: Foundational (T001, T002)
2. Complete Phase 3: US1 — Inline Edit Dialog (T003)
3. Complete Phase 4: US2 — Unified Filters (T004)
4. Complete Phase 5: US3 — Complete Add User Form (T005)
5. **STOP and VALIDATE**: All P1 stories independently testable
6. Commit and deploy if ready

### Incremental Delivery

1. Foundational → T001, T002
2. P1 stories → US1, US2, US3 → Commit
3. P2 stories → US4, US5, US6, US7 → Commit
4. P3 stories → US8, US9, US10 → Commit
5. Polish → T015-T018 → Final commit

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- No schema changes or new server actions — all changes are UI-only
- Commit after each completed user story or logical group
- Stop at any checkpoint to validate story independently
- All sentinel values for null filters use `__double_underscore__` convention
