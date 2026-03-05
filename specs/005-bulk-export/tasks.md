# Tasks: Bulk Data Export (Round-Trip)

**Input**: Design documents from `/specs/005-bulk-export/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Not explicitly requested in feature specification. Test tasks are omitted.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the shared CSV utility that all export endpoints depend on

- [ ] T001 Create CSV generation utility with RFC 4180 escaping, BOM support, and null-to-empty-string handling in `src/lib/csv.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: No additional foundational work needed — auth (`requireAdmin`), crypto (`decryptApiKey`), database schema, and Drizzle ORM are all already in place from feature 004.

**Checkpoint**: Foundation ready — the shared CSV utility from Phase 1 is the only prerequisite for user story work.

---

## Phase 3: User Story 1 — Export License Assignments as CSV (Priority: P1) 🎯 MVP

**Goal**: Admin can export all license assignments as a CSV file with headers `email,tool,tier,workspace,api_key,assigned_at` that is directly re-importable.

**Independent Test**: Trigger assignment export, open CSV in spreadsheet, verify headers match import format, then re-import the unmodified file with zero format validation errors.

### Implementation for User Story 1

- [ ] T002 [US1] Create GET route handler for assignment CSV export with admin auth check, Drizzle join query (licenseAssignments → users, aiTools, accessTiers), API key decryption, date formatting (YYYY-MM-DD), and CSV response with Content-Disposition header in `src/app/api/export/assignments/route.ts`

**Checkpoint**: At this point, assignment export is fully functional via direct URL access (`GET /api/export/assignments`). An admin can hit the endpoint and receive a valid CSV file.

---

## Phase 4: User Story 2 — Export Users as CSV (Priority: P1)

**Goal**: Admin can export all users as a CSV file with headers `name,email,circle,role,github_username,profile` that is directly re-importable.

**Independent Test**: Trigger user export, verify CSV headers match import format, then re-import the unmodified file with zero format validation errors.

### Implementation for User Story 2

- [ ] T003 [P] [US2] Create GET route handler for user CSV export with admin auth check, Drizzle query on users table, null-to-empty-string mapping for optional fields (githubUsername, profile), and CSV response with Content-Disposition header in `src/app/api/export/users/route.ts`

**Checkpoint**: Both export endpoints are functional. Admin can export both assignments and users via direct URL access.

---

## Phase 5: User Story 3 — Export Actions Accessible from Import Pages (Priority: P2)

**Goal**: Export buttons are visible on the import pages so admins can discover and use the round-trip workflow (export → edit → re-import).

**Independent Test**: Navigate to each import page, verify export button is visible, click it, and confirm the file downloads while staying on the same page.

### Implementation for User Story 3

- [ ] T004 [P] [US3] Add "Export Current Assignments" outline button with Lucide Download icon above the import form in `src/app/assignments/import/page.tsx`, linking to `/api/export/assignments`
- [ ] T005 [P] [US3] Add "Export Current Users" outline button with Lucide Download icon above the import form in `src/app/users/import/page.tsx`, linking to `/api/export/users`

**Checkpoint**: All user stories are complete. The full round-trip workflow is functional and discoverable from the import pages.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validation and cleanup across all stories

- [ ] T006 Manually verify round-trip: export assignments CSV → re-import unmodified → confirm zero format errors
- [ ] T007 Manually verify round-trip: export users CSV → re-import unmodified → confirm zero format errors
- [ ] T008 Verify exported CSV opens correctly in a spreadsheet application (Excel or LibreOffice) without encoding issues

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Nothing to do — existing infrastructure is sufficient
- **User Story 1 (Phase 3)**: Depends on Phase 1 (T001 — CSV utility)
- **User Story 2 (Phase 4)**: Depends on Phase 1 (T001 — CSV utility). Independent of US1.
- **User Story 3 (Phase 5)**: Depends on Phases 3 & 4 (export endpoints must exist for buttons to link to)
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Depends only on T001 (CSV utility) — no dependency on other stories
- **User Story 2 (P1)**: Depends only on T001 (CSV utility) — no dependency on other stories
- **User Story 3 (P2)**: Depends on US1 and US2 (endpoints must exist for the buttons to link to)

### Parallel Opportunities

- T002 (US1) and T003 (US2) can run in parallel after T001 completes — they are in different files with no shared dependencies
- T004 and T005 (US3) can run in parallel — they modify different page files

---

## Parallel Example: User Stories 1 & 2

```bash
# After T001 (CSV utility) completes, launch both export routes in parallel:
Task: "Create assignment export route in src/app/api/export/assignments/route.ts"
Task: "Create user export route in src/app/api/export/users/route.ts"

# After both routes exist, launch both UI modifications in parallel:
Task: "Add export button to src/app/assignments/import/page.tsx"
Task: "Add export button to src/app/users/import/page.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Create CSV utility (T001)
2. Complete Phase 3: Assignment export endpoint (T002)
3. **STOP and VALIDATE**: Test assignment export independently via direct URL
4. Export is functional — admin can download assignment CSV

### Incremental Delivery

1. T001 → CSV utility ready
2. T002 → Assignment export works → Validate round-trip (MVP!)
3. T003 → User export works → Validate round-trip
4. T004 + T005 → Export buttons on import pages → Full UX complete
5. T006–T008 → Final validation and polish

### Parallel Execution (with subagents)

1. T001 first (sequential — shared dependency)
2. T002 + T003 in parallel (different API routes, same utility)
3. T004 + T005 in parallel (different page files)
4. T006–T008 sequentially (manual verification)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- No new database tables or dependencies — this feature is purely additive
- CSV utility (T001) is the single shared foundation; everything else branches from it
- API key decryption is the most sensitive operation — must be behind admin auth
- Commit after each task for clean git history
