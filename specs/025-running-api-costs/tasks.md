# Tasks: Running API Costs in Budget View

**Input**: Design documents from `/specs/025-running-api-costs/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md

**Tests**: Included — the plan explicitly calls for unit, integration, and E2E tests.

**Organization**: Tasks grouped by user story. No setup or foundational phases needed — all changes modify existing files in an established codebase.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: User Story 1 - Backfill Populates Historical API Costs (Priority: P1) 🎯 MVP

**Goal**: Fix error handling in the backfill flow so that workspace metadata failures and individual month failures don't abort the entire backfill. This ensures historical months are reliably populated in `anthropic_workspace_costs` and visible in the budget detail view.

**Independent Test**: Trigger a backfill for `anthropic_api_costs` from Settings > Sync, starting 6 months ago. Verify each historical budget period shows running API costs in the budget detail view. Verify partial failures don't abort the backfill.

### Implementation for User Story 1

- [x] T001 [US1] Make workspace metadata sync non-fatal in `src/lib/sync/sources/anthropic-workspace.ts` — wrap `syncWorkspaceMetadata()` call (~line 222-227) in try-catch; on failure, log warning via `console.warn`, increment `counts.errorCount`, set `counts.errorMessage`, but continue to cost sync instead of returning early
- [x] T002 [US1] Add per-month error recovery to backfill loop in `src/lib/sync/sources/anthropic-workspace.ts` — wrap each `fetchAndUpsertWorkspaceCosts(month)` call (~line 238) in try-catch; on failure, increment `counts.errorCount`, append failed month to `counts.errorMessage`, continue to next month; after loop, if `errorCount > 0` but some months succeeded, the framework will set outcome to "partial"
- [x] T003 [US1] Run typecheck and lint to verify no regressions: `pnpm typecheck && pnpm lint`

**Commit checkpoint**: Commit with message `fix(sync): make backfill resilient to per-month and metadata failures`

### Tests for User Story 1

- [ ] T004 [P] [US1] Create unit tests in `tests/unit/sync/anthropic-workspace-backfill.test.ts` — test cases: (1) workspace metadata failure does not prevent cost sync, (2) single month API failure does not abort backfill and remaining months still sync, (3) error counts and messages correctly reflect partial failures, (4) successful backfill with no errors returns zero errorCount. Mock `fetchCostReport` and `syncWorkspaceMetadata` using vi.mock pattern from existing tests.
- [ ] T005 [P] [US1] Complete stub integration test in `tests/integration/sync/workspace-costs.test.ts` — test cases: (1) backfill upserts are idempotent (run twice, verify same row count and amounts), (2) backfill creates rows for each month in range. Follow seed/verify/cleanup pattern from `tests/integration/invoice-sync.test.ts`.
- [ ] T006 [US1] Run all tests to verify: `pnpm test && pnpm test:integration`

**Commit checkpoint**: Commit with message `test(sync): add backfill error handling and idempotency tests`

**Checkpoint**: Backfill is now resilient to partial failures. Historical data populates budget detail view correctly.

---

## Phase 2: User Story 2 - Normal Sync Updates Without Duplication (Priority: P1)

**Goal**: Regression guard — verify that backfill error handling changes in US1 did not break the existing current-month sync behavior. No code changes expected; this phase is test-only.

**Independent Test**: Run the regular `anthropic_api_costs` sync three times. Verify exactly one workspace cost row per workspace per month. Verify budget view total matches latest sync data.

### Verification for User Story 2

- [ ] T007 [US2] Verify regular sync path is unaffected by reading `src/lib/sync/sources/anthropic-workspace.ts` and confirming the non-backfill branch (when `opts?.backfillStartDate` is not set) is unchanged — the metadata try-catch applies to both paths but per-month error recovery only applies to backfill loop
- [ ] T008 [US2] Run full test suite to confirm no regressions: `pnpm test && pnpm test:integration`

**Checkpoint**: Existing current-month sync behavior confirmed intact. No commits needed unless fixes are required.

---

## Phase 3: User Story 3 - Complete Budget View Across All Periods (Priority: P2)

**Goal**: Add running API cost totals to the budget overview page summary cards, so that the overview reflects historical API costs after backfill — not just billed costs.

**Independent Test**: After running a backfill, navigate to `/budget`. Verify the active budget summary card shows "Actual (incl. API)" with a total that includes both billed costs and running API costs. Verify variance is calculated against the combined total.

### Implementation for User Story 3

- [x] T009 [US3] Add running cost fetching to budget overview in `src/app/budget/page.tsx` — after `activeBudgetWithCosts` is loaded (~line 31-33), fetch running costs for each period using `Promise.all()` + `getRunningCostsForPeriod()` pattern (copy from `src/app/budget/[id]/page.tsx` lines 37-47); compute `totalRunning` by summing all `runningCostCents` values; import `getRunningCostsForPeriod` from `@/lib/budget-utils` and `RunningCostData` type
- [x] T010 [US3] Update budget overview summary cards in `src/app/budget/page.tsx` — modify the "Billed" card (~line 116-121): if `totalRunning > 0`, change label to "Actual (incl. API)" and show `totalBilled + totalRunning`; if no running costs, keep existing "Billed" label with `totalBilled`. Update variance calculation (~line 50) to use `totalBilled + totalRunning` when running costs exist.
- [x] T011 [US3] Run typecheck and lint: `pnpm typecheck && pnpm lint`

**Commit checkpoint**: Commit with message `feat(budget): show running API costs in budget overview summary`

### Tests for User Story 3

- [ ] T012 [US3] Extend E2E test in `tests/e2e/budget-period-running-costs.spec.ts` — add test case: navigate to `/budget` overview page, verify "Actual (incl. API)" label appears when running costs exist, verify combined total is displayed
- [ ] T013 [US3] Run all tests: `pnpm test && pnpm test:integration`

**Commit checkpoint**: Commit with message `test(budget): add E2E test for overview running costs display`

**Checkpoint**: Budget overview now shows combined API + billed costs. All user stories complete.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Final verification and cleanup

- [ ] T014 Run full verification suite: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration`
- [ ] T015 Verify end-to-end flow manually per quickstart.md: trigger backfill from UI, check budget detail shows historical API costs, check budget overview shows combined totals
- [ ] T016 Review all modified files for any leftover console.log or debug statements

**Commit checkpoint**: Only if cleanup changes are needed.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (US1)**: No dependencies — can start immediately
- **Phase 2 (US2)**: Depends on Phase 1 completion (verifies US1 changes don't regress)
- **Phase 3 (US3)**: No dependency on Phase 1/2 — modifies different files (`budget/page.tsx` vs `anthropic-workspace.ts`)
- **Phase 4 (Polish)**: Depends on all phases complete

### Parallel Opportunities

- **T004 and T005** can run in parallel (different test files)
- **Phase 1 implementation (T001-T003) and Phase 3 implementation (T009-T011)** can run in parallel (different source files, no code dependencies)

### Within Each Phase

- Implementation tasks are sequential within a phase (same file modifications)
- Test tasks can run in parallel where marked [P]
- Commit after each checkpoint

---

## Parallel Example: Maximum Parallelism

```bash
# These two streams can run simultaneously:

# Stream A (US1 - backfill error handling):
T001 → T002 → T003 → commit → T004 + T005 (parallel) → T006 → commit

# Stream B (US3 - budget overview):
T009 → T010 → T011 → commit → T012 → T013 → commit

# After both streams complete:
T007 → T008 (US2 regression check)
T014 → T015 → T016 (polish)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Fix backfill error handling (T001-T006)
2. **STOP and VALIDATE**: Trigger backfill, verify historical periods show in budget detail
3. This alone delivers the core value — reliable historical cost data in the budget

### Incremental Delivery

1. US1 (backfill fixes) → Historical data now shows in budget detail → Commit
2. US3 (overview integration) → Overview page includes API costs → Commit
3. US2 (regression verification) → Confidence that nothing broke → Commit
4. Polish → Final cleanup → Commit

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Commit after each checkpoint as requested
- Use subagents for parallel streams (US1 + US3 can run simultaneously)
- No schema changes, no new dependencies — all tasks modify existing files
- Total: 16 tasks across 4 phases
