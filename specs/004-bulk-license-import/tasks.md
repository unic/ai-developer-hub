# Tasks: Bulk License Import, API Key Management & User Profile Extension

**Input**: Design documents from `/specs/004-bulk-license-import/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/server-actions.md, contracts/ui-contracts.md, research.md, quickstart.md

**Tests**: No test tasks generated — tests were not explicitly requested in the feature specification.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths are included in every task description

---

## Phase 1: Setup (DB Schema Migration)

**Purpose**: Apply the only schema change in this feature — the new `user_profile` enum and `profile` column on users. Must complete before US3 can be implemented.

- [x] T001 Add `userProfileEnum` pgEnum (`["boost", "maxed", "indie"]`) and nullable `profile: userProfileEnum("profile")` column to the `users` table in `src/lib/db/schema.ts`
- [x] T002 Push schema to database by running `pnpm db:push` to apply the enum and column migration

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared type export used by US3 UI components. Must complete before user story phases begin.

**Note**: US1 and US2 have no schema dependencies and can begin immediately after Phase 1. US3 additionally depends on this phase.

- [x] T003 Add `UserProfile` type alias (`"boost" | "maxed" | "indie"`) export to `src/types/index.ts`

**Checkpoint**: Foundation ready — US1 and US2 can start immediately; US3 can start once T003 is complete.

---

## Phase 3: User Story 1 — Bulk Import License Assignments (Priority: P1) — MVP

**Goal**: Admin can upload a CSV of license assignments, preview row-by-row validation, and import all valid rows in a single action with a results summary.

**Independent Test**: Upload a CSV with a mix of valid rows and invalid rows (unknown email, unknown tool, duplicate active assignment, bad date). Verify the preview shows correct Valid/Error status per row. Click Import and confirm only valid rows are created as license assignments with correct tool, tier, workspace, encrypted API key, and assignment date from the CSV. Confirm the summary toast reports correct counts.

### Implementation for User Story 1

- [x] T004 [P] [US1] Add `bulkImportAssignmentRowSchema` Zod schema (fields: `email`, `tool`, `tier`, `workspace`, `apiKey` optional, `assignedAt` YYYY-MM-DD regex) to `src/lib/validators.ts`
- [x] T005 [US1] Implement `bulkImportAssignments` server action in `src/actions/assignments.ts`: require admin auth, validate each row, resolve email→userId, tool name→toolId (ilike), tier name→tierId (ilike, scoped to tool), check duplicate active assignment (user+tool), insert individually with best-effort (try/catch per row), set `costAtAssignmentCents` from tier, encrypt `apiKey` via `encryptApiKey()` if present, use `assignedAt` from CSV, revalidate `/assignments`, return `{ imported, failed, errors[] }` (depends on T004)
- [x] T006 [P] [US1] Create server component page `src/app/assignments/import/page.tsx` with admin-only guard (redirect non-admins) that renders the `BulkAssignmentImportForm` client component
- [x] T007 [US1] Create `src/app/assignments/import/bulk-assignment-import-form.tsx` client component: file input (CSV only), client-side CSV parsing via `FileReader`, preview table with columns Email/Tool/Tier/Workspace/API Key (masked)/Assigned At/Status badge (Valid in green, error text in red with `bg-destructive/10` row highlight), summary line "{valid} valid, {invalid} invalid of {total} total", "Import N Assignment(s)" button calling `bulkImportAssignments` action, post-import toast summary (depends on T005, T006)
- [x] T008 [US1] Add "Import Assignments" button/link to the assignments list page `src/app/assignments/page.tsx` following the same pattern as the "Import Users" button on the users page

**Checkpoint**: User Story 1 is fully functional — admin can bulk import license assignments end-to-end.

---

## Phase 4: User Story 2 — Manage API Key on Assignment Detail (Priority: P2)

**Goal**: Admin can add, update, or clear the API key on any individual assignment's detail page without re-importing.

**Independent Test**: Navigate to an existing assignment with no API key as admin. Enter a key and save — masked key and reveal/copy controls appear. Navigate to an assignment with an existing key, update it — new key is revealed. Click "Clear API Key" — key is removed. Log in as non-admin viewer and confirm the edit controls are not visible.

### Implementation for User Story 2

- [x] T009 [US2] Update `updateAssignment` server action in `src/actions/assignments.ts` to treat an empty string `apiKey: ""` as a "clear" operation by setting `apiKeyEncrypted: null`, distinct from `undefined` (no change)
- [x] T010 [US2] Add API key edit controls to `src/app/assignments/[id]/assignment-detail-client.tsx` (admin only): when no key exists show a text input + "Save" button; when key exists show existing masked key + reveal/copy + "Update" input expand; "Clear API Key" button that sends `apiKey: ""` to `updateAssignment`; non-admin users see read-only masked key only (depends on T009)

**Checkpoint**: User Story 2 is fully functional — admin can manage API keys on individual assignment detail pages.

---

## Phase 5: User Story 3 — User Profile Field (Priority: P3)

**Goal**: Users have an optional `profile` field (Boost / Maxed / Indie) visible on the users list, settable on the user detail and create forms, and importable via bulk user CSV.

**Independent Test**: Edit an existing user and set profile to each of the three values — verify saves and appears on detail page and users list. Create a new user with profile set — verify it persists. Use bulk user import with a `profile` column containing valid values, invalid values, and blank values — verify correct import and error marking.

### Implementation for User Story 3

- [x] T011 [US3] Add optional `profile: z.enum(["boost", "maxed", "indie"]).optional()` to `createUserSchema` and `bulkImportUserRowSchema`, and add `profile: z.enum(["boost", "maxed", "indie"]).nullable().optional()` to `updateUserSchema` in `src/lib/validators.ts`
- [x] T012 [US3] Update `createUser` server action in `src/actions/users.ts` to accept and persist the `profile` field to the new `users.profile` column (depends on T011)
- [x] T013 [US3] Update `updateUser` server action in `src/actions/users.ts` to accept and persist `profile` (null clears the field); include profile change in the change history entry if it changed (depends on T011, T012 — same file, sequential)
- [x] T014 [US3] Update `bulkImportUsers` server action in `src/actions/users.ts` to parse the optional `profile` CSV column, validate case-insensitively against allowed values, mark rows invalid with a descriptive error when value is unrecognized, and persist valid profile values on insert (depends on T013)
- [x] T015 [P] [US3] Add optional `profile` `<Select>` dropdown (options: None / Boost / Maxed / Indie) after the role field in `src/app/users/new/new-user-form.tsx`; default to no selection (depends on T011)
- [x] T016 [P] [US3] Add `profile` `<Select>` field to the edit form and a Profile Badge in the user header area of `src/app/users/[id]/user-detail-client.tsx`; show "—" when null (depends on T011)
- [x] T017 [P] [US3] Add a "Profile" column to `src/app/users/users-table.tsx` that displays the profile as a Badge when set and "—" when null (depends on T003)
- [x] T018 [US3] Add `profile` column support to `src/app/users/import/bulk-import-form.tsx`: parse column, show in preview table, pass to `bulkImportUsers` action (depends on T014)

**Checkpoint**: All three user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verification and cleanup across all stories.

- [x] T019 [P] Run `pnpm typecheck` and resolve any TypeScript strict-mode errors introduced by this feature
- [x] T020 [P] Run `pnpm lint` and resolve any ESLint warnings or errors
- [x] T021 Validate end-to-end against all three quickstart.md test scenarios (bulk assignment import, API key management, user profile field)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion — blocks US3 only
- **US1 (Phase 3)**: Depends only on Phase 1 — can start immediately after schema migration
- **US2 (Phase 4)**: Depends only on Phase 1 — can start immediately after schema migration; independent of US1
- **US3 (Phase 5)**: Depends on Phase 1 + Phase 2 — US1 and US2 do NOT need to be complete first
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: No dependency on US2 or US3 — fully independent
- **US2 (P2)**: No dependency on US1 or US3 — fully independent
- **US3 (P3)**: No dependency on US1 or US2 — fully independent (requires schema migration from Phase 1)

### Within Each User Story

- Validators before server actions (T004 → T005; T011 → T012 → T013 → T014)
- Server actions before client components
- Server page before client form (T006 → T007)
- Same-file modifications are sequential (T012 → T013 → T014 all touch `src/actions/users.ts`)

### Parallel Opportunities

- After Phase 1 completes: US1, US2, and US3 can all begin in parallel
- Within US1: T004 (validators) and T006 (server page) can run in parallel — different files
- Within US3: T015, T016, T017 can all run in parallel — different files
- Phase 6: T019 and T020 can run in parallel

---

## Parallel Example: User Story 1

```bash
# These two tasks can run in parallel (different files):
T004: Add bulkImportAssignmentRowSchema to src/lib/validators.ts
T006: Create src/app/assignments/import/page.tsx

# Then once T004 and T006 are done, T007 can proceed:
T005: Implement bulkImportAssignments in src/actions/assignments.ts  (after T004)
T007: Create bulk-assignment-import-form.tsx  (after T005 + T006)
T008: Add Import Assignments button to assignments page  (independent)
```

## Parallel Example: User Story 3

```bash
# These three UI tasks can run in parallel (different files):
T015: Add profile Select to src/app/users/new/new-user-form.tsx
T016: Add profile Select+Badge to src/app/users/[id]/user-detail-client.tsx
T017: Add Profile column to src/app/users/users-table.tsx

# Action updates are sequential (same file):
T011 → T012 → T013 → T014  (all touch src/actions/users.ts or src/lib/validators.ts)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: DB Schema Migration (T001–T002)
2. Complete Phase 2: Foundational (T003)
3. Complete Phase 3: User Story 1 (T004–T008)
4. **STOP and VALIDATE**: Upload a test CSV, verify preview and import work end-to-end
5. Demo / deploy if ready

### Incremental Delivery

1. Phase 1 + Phase 2 → Foundation ready
2. Phase 3 (US1) → Admin can bulk import assignments (MVP)
3. Phase 4 (US2) → Admin can manage API keys on individual assignments
4. Phase 5 (US3) → Users have profile classification
5. Phase 6 → Polish and verify

### Parallel Team Strategy

After Phase 1 + Phase 2 complete:

- **Developer A**: User Story 1 (T004–T008)
- **Developer B**: User Story 2 (T009–T010)
- **Developer C**: User Story 3 (T011–T018)

All three stories are file-independent and can be merged without conflicts.

---

## Summary

| Phase | Story | Tasks | Parallel Opportunities |
|-------|-------|-------|------------------------|
| Phase 1: Setup | — | T001–T002 | None (sequential) |
| Phase 2: Foundational | — | T003 | — |
| Phase 3: US1 (P1) | Bulk Assignment Import | T004–T008 | T004 ∥ T006 |
| Phase 4: US2 (P2) | API Key Management | T009–T010 | None (sequential) |
| Phase 5: US3 (P3) | User Profile Field | T011–T018 | T015 ∥ T016 ∥ T017 |
| Phase 6: Polish | — | T019–T021 | T019 ∥ T020 |

**Total tasks**: 21
**Tasks per user story**: US1 = 5, US2 = 2, US3 = 8
**Parallel opportunities**: 5 identified across phases
**Suggested MVP scope**: Phase 1 + Phase 2 + Phase 3 (User Story 1 only)

---

## Notes

- `[P]` tasks = different files, no unresolved dependencies — safe to run in parallel
- `[Story]` label maps each task to a specific user story for independent traceability
- No test tasks generated — add if TDD approach is desired (`pnpm test` for Vitest, `pnpm test:e2e` for Playwright)
- Existing `encryptApiKey()` in `src/lib/crypto.ts` is reused as-is for both US1 and US2
- `updateAssignment` in `src/actions/assignments.ts` already supports `apiKey` — US2 only requires the empty-string-as-clear behavior and the UI controls
- Commit after each phase checkpoint to preserve independently testable increments
