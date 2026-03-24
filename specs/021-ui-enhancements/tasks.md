# Tasks: UI Enhancements — Assignment & User Detail Polish

**Input**: Design documents from `/specs/021-ui-enhancements/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Not explicitly requested — test tasks omitted. Existing tests should be updated where they break.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: No project initialization needed — this feature modifies existing files only. No new dependencies, no schema changes.

*Phase skipped — proceed directly to user stories.*

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: No foundational tasks needed. All four user stories are independent and modify different sections of existing files. No shared infrastructure changes are required.

*Phase skipped — user story implementation can begin immediately.*

---

## Phase 3: User Story 1 - Clickable Assigned Tools in User Detail (Priority: P1) 🎯 MVP

**Goal**: Each assigned tool entry on the user detail page is a clickable link that navigates to the corresponding assignment detail page.

**Independent Test**: View any user with assigned tools → click a tool entry → verify navigation to `/assignments/{id}`.

### Implementation for User Story 1

- [ ] T001 [US1] Wrap each assignment entry in the "Assigned Tools" card with a Next.js `Link` component pointing to `/assignments/${a.id}` in `src/app/users/[id]/user-detail-client.tsx` (lines ~479-553). Import `Link` from `next/link`. The entire tool row (name, tier, cost, dates) should be the clickable area. Add hover styling (`hover:bg-muted/50 transition-colors`) to indicate interactivity. Ensure the existing revoke/reactivate action buttons remain outside the link to avoid nested interactive elements.

- [ ] T002 [US1] Verify that the `Link` component is keyboard-accessible (focusable via Tab, activatable via Enter) and has appropriate visual focus indicators consistent with the design system. Test with both active and revoked assignments to confirm navigation works for all statuses.

**Checkpoint**: User Story 1 is complete. Administrators can click any assigned tool to navigate directly to its assignment detail page.

---

## Phase 4: User Story 2 - Unified Assignment Detail View (Priority: P1)

**Goal**: Merge the separate "Assignment Details" read-only card and "Edit Assignment" form card into a single unified card where each field is displayed once with inline edit capability for admins on active assignments.

**Independent Test**: Navigate to an active assignment → verify single card with inline edit controls, no duplicate fields. Navigate to a revoked assignment → verify read-only view with no edit controls.

### Implementation for User Story 2

- [ ] T003 [US2] In `src/app/assignments/[id]/assignment-detail-client.tsx`, restructure the detail card (lines ~248-371) to integrate edit controls inline. For each editable field (tier, assigned date, workspace, API key), replace the read-only display with the corresponding form control from the current edit card (lines ~386-529) when the user is an admin and the assignment is active. Wrap the entire card content in the existing `<Form>` component. Keep non-editable fields (status badge, cost display, revoked date) as read-only. Each field row should show a label on the left and the value/control on the right, using the same grid/flex layout as the current detail card.

- [ ] T004 [US2] Remove the separate "Edit Assignment" `<Card>` section (lines ~374-542) from `src/app/assignments/[id]/assignment-detail-client.tsx`. The "Save Changes" button should now appear at the bottom of the unified detail card, visible only for admins on active assignments. Move the tier-loading `useEffect` and `loadTiers` callback to remain at the component level (they already are — just verify they still work after the card merge).

- [ ] T005 [US2] Ensure the unified card displays correctly for non-admin users and revoked assignments: all fields should render as plain text (the current detail card format) with no form controls, no "Save Changes" button. The API key display (masked with reveal/copy buttons) should still work for read-only view. Test that the `form.handleSubmit(onSubmit)` still triggers correctly from the unified card.

**Checkpoint**: User Story 2 is complete. The assignment detail page shows each field exactly once. Active assignments have inline edit controls; revoked assignments are read-only.

---

## Phase 5: User Story 3 - Allow Assignment Dates Before User Creation (Priority: P2)

**Goal**: Remove the server-side validation that rejects assignment dates earlier than the user's account creation date.

**Independent Test**: Edit an assignment's date to a date before the user's `createdAt` → verify it succeeds. Confirm future dates are still rejected. Confirm dates before tool creation are still rejected.

### Implementation for User Story 3

- [ ] T006 [US3] In `src/actions/assignments.ts`, remove the validation block (lines ~236-242) in the `updateAssignment` function that checks `if (newDate < assignment.user.createdAt)` and returns an error. Keep the future-date check (lines ~232-233), the tool-creation-date check (lines ~245-250), and the 12-month warning (lines ~252-257) unchanged.

- [ ] T007 [US3] Update any existing unit or integration tests in `tests/` that assert the "Assigned date cannot be before the user was created" error behavior. These tests should now expect success for dates before user creation while continuing to assert failure for future dates and dates before tool creation.

**Checkpoint**: User Story 3 is complete. Dates before user creation are accepted. All other date validations remain enforced.

---

## Phase 6: User Story 4 - Workspace and API Key Fields on New Assignment (Priority: P2)

**Goal**: Add optional workspace and API key fields to the new license assignment dialog and the server action that creates assignments.

**Independent Test**: From user detail page, assign a license with workspace and API key filled in → verify values appear on the resulting assignment detail page.

### Implementation for User Story 4

- [ ] T008 [P] [US4] Extend `assignmentSchema` in `src/lib/validators.ts` (lines ~58-62) to add `workspace: z.string().max(200).optional()` and `apiKey: z.string().max(500).refine((val) => val === "" || val.trim().length > 0, { message: "API key cannot be blank" }).transform((val) => (val === "" ? val : val.trim())).optional()`. This matches the existing `updateAssignmentSchema` pattern for these fields.

- [ ] T009 [P] [US4] Update the `assignLicense` function in `src/actions/assignments.ts` (lines ~25-134) to destructure `workspace` and `apiKey` from the parsed input. If `apiKey` is provided and non-empty, encrypt it using `encryptApiKey()` from `src/lib/crypto.ts`. Include `workspace` and `apiKeyEncrypted` in the `db.insert(licenseAssignments).values({...})` call (lines ~111-118). Import `encryptApiKey` if not already imported.

- [ ] T010 [US4] Add workspace and API key fields to the assignment dialog in `src/app/users/[id]/user-detail-client.tsx` (lines ~564-621). After the Tier select dropdown (~line 604), add: (1) a text `<Input>` for workspace with `placeholder="e.g. team-alpha"`, `maxLength={200}`, and a `<label className="text-sm font-medium">Workspace (optional)</label>`; (2) a password `<Input>` for API key with show/hide toggle button (using `Eye`/`EyeOff` icons from Lucide), `maxLength={500}`, and a `<label className="text-sm font-medium">API Key (optional)</label>`. Add corresponding React state variables (`assignWorkspace`, `assignApiKey`, `showAssignApiKey`). Pass `workspace` and `apiKey` to the `assignLicense` call in the submit handler. Reset these fields when the dialog closes or after successful submission.

**Checkpoint**: User Story 4 is complete. New assignments can be created with workspace and API key in a single step.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final verification across all stories.

- [ ] T011 Run `pnpm typecheck` to verify TypeScript compilation passes with zero errors across all modified files
- [ ] T012 Run `pnpm lint` to verify ESLint passes with zero warnings across all modified files
- [ ] T013 Run `pnpm build` to verify production build succeeds
- [ ] T014 Run quickstart.md validation: manually verify all 4 verification steps described in `specs/021-ui-enhancements/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Skipped — no setup needed
- **Foundational (Phase 2)**: Skipped — no shared prerequisites
- **User Stories (Phase 3-6)**: Can all start immediately in parallel
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: No dependencies — modifies only `user-detail-client.tsx` (assigned tools section)
- **User Story 2 (P1)**: No dependencies — modifies only `assignment-detail-client.tsx`
- **User Story 3 (P2)**: No dependencies — modifies only `assignments.ts` (validation removal)
- **User Story 4 (P2)**: No dependencies on other stories — modifies `validators.ts`, `assignments.ts` (create function), and `user-detail-client.tsx` (dialog section)

**Note**: US1 and US4 both modify `user-detail-client.tsx` but in different sections (US1: assigned tools card ~lines 479-553, US4: assignment dialog ~lines 564-621), so they can be developed in parallel without conflicts.

**Note**: US3 and US4 both modify `assignments.ts` but in different functions (US3: `updateAssignment` ~line 236, US4: `assignLicense` ~line 25), so they can be developed in parallel without conflicts.

### Within Each User Story

- T008 and T009 (US4) are marked [P] — they modify different files and can run in parallel
- T010 (US4) depends on T008 and T009 completing first (needs the updated schema and action)

### Parallel Opportunities

- **Maximum parallelism**: All 4 user stories can be worked on simultaneously
- **Within US4**: T008 (validators.ts) and T009 (assignments.ts) can run in parallel
- **Recommended order for single developer**: US1 → US3 → US4 → US2 (simplest to most complex)

---

## Parallel Example: All User Stories

```bash
# All four stories can launch in parallel (different files):
Agent 1: T001-T002 [US1] user-detail-client.tsx (assigned tools section)
Agent 2: T003-T005 [US2] assignment-detail-client.tsx
Agent 3: T006-T007 [US3] assignments.ts (updateAssignment)
Agent 4: T008-T010 [US4] validators.ts + assignments.ts (assignLicense) + user-detail-client.tsx (dialog)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete T001-T002: Clickable tool entries
2. **STOP and VALIDATE**: Click any assigned tool → navigates to assignment detail
3. Deploy/demo if ready — immediate value with minimal risk

### Incremental Delivery

1. US1 (Clickable tools) → Test → Deploy — single click navigation ✓
2. US3 (Date validation) → Test → Deploy — backdate assignments ✓
3. US4 (Workspace/API key) → Test → Deploy — complete assignment creation ✓
4. US2 (Unified view) → Test → Deploy — clean, deduplicated UI ✓
5. Polish (T011-T014) → Final validation

### Parallel Team Strategy

With multiple developers:
1. No shared setup — start all stories immediately
2. Developer A: US1 + US3 (quick wins, ~30 min each)
3. Developer B: US2 (largest change, ~1-2 hours)
4. Developer C: US4 (moderate, ~45 min)
5. All merge and run polish phase together

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- No new files created — all modifications to existing code
- Net code reduction expected (US2 removes ~120 lines of duplication)
- Commit after each user story completion for clean git history
