# Tasks: Bulk User Import with Upsert & Export

**Input**: Design documents from `/specs/011-user-import/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/server-actions.md

**Tests**: Not explicitly requested in spec — test tasks omitted.

**Organization**: Tasks grouped by user story. US1 and US3 are combined (same server action handles both create and update paths).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US4)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Types & Validators)

**Purpose**: Define shared types and schemas that all user stories depend on

- [x] T001 Add `BulkImportResult` and `ExistingUserFields` types in `src/types/index.ts` — add types for upsert result (created, updated, skipped, failed, errors) and existing user field map for preview lookup
- [x] T002 Update `bulkImportUserSchema` in `src/lib/validators.ts` — no schema changes needed but verify round-trip compatibility: empty strings for nullable fields should be accepted and normalized to null

**Checkpoint**: Shared types compiled and ready for use by server actions and UI

---

## Phase 2: User Story 1 + 3 — Upsert Import & New User Creation (Priority: P1) MVP

**Goal**: The `bulkImportUsers` server action supports both creating new users and updating existing users (matched by email). Passwords and status are never modified for existing users. Unchanged rows are skipped. Change history is recorded for all updates.

**Independent Test**: Import a CSV with a mix of new emails, existing emails with changes, and existing emails without changes. Verify correct counts for created/updated/skipped/failed. Verify passwords unchanged. Verify change history entries.

### Implementation for User Story 1 + 3

- [x] T003 [US1] Add `checkExistingUsers` server action in `src/actions/users.ts` — accepts email list, returns `Record<string, ExistingUserFields>` map of lowercase email to current field values using `inArray` query. Requires admin role.
- [x] T004 [US1] Add field comparison helper in `src/actions/users.ts` — create a `computeUserDiff` function that compares CSV row fields (name, circle, role, githubUsername, profile) against existing user record, normalizing empty strings to null for nullable fields. Returns `Record<string, { old: unknown; new: unknown }>` for changed fields, or empty object if no changes.
- [x] T005 [US1] Modify `bulkImportUsers` in `src/actions/users.ts` — replace the existing "skip if email exists" logic with upsert behavior: (1) if no existing user, create with default password and `recordCreation` (existing path), (2) if existing user found, call `computeUserDiff` — if changes exist, update user fields via `db.update()` and call `recordUpdate` with diff; if no changes, increment skipped count. Never modify passwordHash or status. Return `BulkImportResult` with created/updated/skipped/failed counts.
- [x] T006 [US1] Update import summary toast in `src/app/users/import/bulk-import-form.tsx` — modify the post-import toast notification to display the new four-category summary: "X created, Y updated, Z skipped, W failed" instead of the current "X imported, Y failed".

**Checkpoint**: Core upsert logic works end-to-end. Re-importing an unmodified export shows all rows skipped. Importing a mix of new and existing users shows correct counts. Passwords preserved.

---

## Phase 3: User Story 2 — Export from User Overview Page (Priority: P2)

**Goal**: An export CSV button is visible to administrators on the user overview page, linking to the existing `/api/export/users` endpoint.

**Independent Test**: Navigate to `/users` as admin — export button visible. Click it — CSV downloads. Navigate as viewer — no export button.

### Implementation for User Story 2

- [x] T007 [P] [US2] Add export button to admin button group in `src/app/users/page.tsx` — add a `<Button variant="outline" asChild>` wrapping an `<a href="/api/export/users" download>` with a Download icon (from lucide-react), placed before the existing "Bulk Import" button in the admin-only button group. Only visible when `isAdmin` is true.

**Checkpoint**: Export button visible on user overview page for admins, triggers CSV download.

---

## Phase 4: User Story 4 — Import Preview with Update Indicators (Priority: P2)

**Goal**: The import preview table shows each row labeled as "New" or "Update". For update rows, fields that differ from the current database values are visually highlighted.

**Independent Test**: Upload a CSV with a mix of new and existing users. Verify preview labels rows correctly. Verify changed fields are highlighted for update rows.

### Implementation for User Story 4

- [x] T008 [US4] Add email lookup on CSV parse in `src/app/users/import/bulk-import-form.tsx` — after CSV parsing completes, collect all parsed emails and call `checkExistingUsers` server action. Store the returned `Record<string, ExistingUserFields>` map in component state.
- [x] T009 [US4] Compute row action and changed fields in `src/app/users/import/bulk-import-form.tsx` — for each parsed row, determine action ("new" if email not in existing map, "update" if in map) and compute list of changed field names by comparing CSV values to existing values (same normalization as server-side: empty string = null for nullable fields).
- [x] T010 [US4] Add New/Update badge column to preview table in `src/app/users/import/bulk-import-form.tsx` — add an "Action" column to the preview table showing a Badge: "New" (default/outline variant) or "Update" (secondary variant) based on the computed action for each row.
- [x] T011 [US4] Highlight changed fields in preview table in `src/app/users/import/bulk-import-form.tsx` — for "Update" rows, apply a visual indicator (e.g., `font-semibold text-primary` or subtle background highlight) to table cells whose field name appears in the row's changed fields list.

**Checkpoint**: Preview correctly labels all rows. Changed fields visually distinguishable. Error rows still show validation errors.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and edge case handling

- [x] T012 Verify round-trip compatibility by testing export → re-import with no changes in `src/app/users/import/bulk-import-form.tsx` and `src/actions/users.ts` — ensure empty string normalization in CSV parsing matches the export format (null fields exported as empty strings, empty strings imported as null). Fix any mismatches.
- [x] T013 Verify change history completeness in `src/actions/users.ts` — ensure `recordUpdate` is called with correct `changedBy` (admin user ID from session) and that each changed field produces a separate history entry. Test with a bulk update affecting multiple fields on multiple users.
- [x] T014 [P] Run `pnpm typecheck` and `pnpm lint` — fix any TypeScript errors or lint warnings introduced by the changes.
- [ ] T015 Run quickstart.md manual testing workflow — follow the 9-step manual test plan from `specs/011-user-import/quickstart.md` to validate the full export-edit-import workflow end-to-end.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **US1+US3 (Phase 2)**: Depends on Phase 1 (types must exist)
- **US2 (Phase 3)**: Independent — can run in parallel with Phase 2
- **US4 (Phase 4)**: Depends on Phase 2 (needs `checkExistingUsers` action)
- **Polish (Phase 5)**: Depends on Phases 2, 3, and 4

### User Story Dependencies

- **US1+US3 (P1)**: Depends on Setup only — core MVP
- **US2 (P2)**: Fully independent — only touches `src/app/users/page.tsx`
- **US4 (P2)**: Depends on `checkExistingUsers` from US1 — must wait for Phase 2

### Within Each Phase

- T003 and T004 can run in parallel (different functions, same file but independent)
- T005 depends on T003 and T004 (uses both)
- T006 depends on T005 (needs new return type)
- T008 depends on T003 (calls `checkExistingUsers`)
- T009 depends on T008 (needs existing user map)
- T010 and T011 depend on T009 (need computed actions/changes)

### Parallel Opportunities

- Phase 2 (US1+US3) and Phase 3 (US2) can run in parallel
- T003 and T004 within Phase 2 can run in parallel
- T014 (lint/typecheck) can run in parallel with T012/T013

---

## Parallel Example: Phase 2 + Phase 3

```bash
# These can run in parallel (different files):
Task T003: "Add checkExistingUsers action in src/actions/users.ts"
Task T007: "Add export button in src/app/users/page.tsx"

# Within Phase 2, these can run in parallel:
Task T003: "checkExistingUsers action"
Task T004: "computeUserDiff helper"
```

---

## Implementation Strategy

### MVP First (Phase 1 + Phase 2)

1. Complete Phase 1: Setup types
2. Complete Phase 2: US1+US3 upsert logic
3. **STOP and VALIDATE**: Test upsert with mixed CSV
4. This alone delivers the core value — bulk updates work

### Incremental Delivery

1. Phase 1 + Phase 2 → Upsert works (MVP!)
2. Add Phase 3 (US2) → Export discoverable on user page
3. Add Phase 4 (US4) → Preview shows New/Update with highlights
4. Phase 5 → Polish, verify, ship

---

## Notes

- No new dependencies required — all changes use existing stack
- No database schema changes — all modifications at application level
- US1 and US3 are combined because they share the same server action (`bulkImportUsers`)
- The existing export API (`/api/export/users`) is unchanged
- Commit after each task or logical group as requested
