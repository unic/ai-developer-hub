# Tasks: Decouple Copilot Billing from Budgets

**Input**: Design documents from `/specs/014-decouple-copilot-billing/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, quickstart.md

**Tests**: Not requested — no test tasks included.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: No project initialization needed — this feature modifies an existing codebase with no new dependencies.

*(No tasks in this phase)*

---

## Phase 2: Foundational (Schema Changes)

**Purpose**: Modify the database schema to remove the billing coupling column. This MUST complete before migration generation.

**⚠️ CRITICAL**: Migration generation (Phase 4) depends on this phase being complete.

- [x] T001 [P] Remove `linkedBilledCostId` column definition from `copilotBillingSnapshots` table in `src/lib/db/schema.ts` (lines ~426-429). Remove the `integer("linked_billed_cost_id").references(() => billedCosts.id, { onDelete: "set null" })` field.
- [x] T002 [P] Remove `copilot_billing_snapshots_linked_cost_idx` index from the table's index array in `src/lib/db/schema.ts` (line ~438). Remove the `index("copilot_billing_snapshots_linked_cost_idx").on(table.linkedBilledCostId)` entry.
- [x] T003 Remove `linkedBilledCost` relation from `copilotBillingSnapshotsRelations` in `src/lib/db/schema.ts` (lines ~591-594). Remove the `linkedBilledCost: one(billedCosts, { fields: [copilotBillingSnapshots.linkedBilledCostId], references: [billedCosts.id] })` entry. If `billedCosts` import is no longer used anywhere in the relations block, remove it from imports too.

**Checkpoint**: Schema no longer references `linkedBilledCostId`. TypeScript will report compile errors at all remaining reference sites.

---

## Phase 3: User Story 1 — Copilot Sync Runs Without Budget Dependency (Priority: P1) 🎯 MVP

**Goal**: Remove all billing coupling from the sync pipeline so Copilot sync completes without budget/invoice configuration.

**Independent Test**: Enable Copilot sync on an org with no budgets configured. Verify all sync stages complete without errors and billing snapshots are stored.

### Implementation for User Story 1

- [x] T004 [P] [US1] Remove budget period lookup and `billedCosts` creation logic from `syncBillingData()` in `src/lib/copilot-sync.ts` (lines ~148-191). Delete the entire block that queries `budgetPeriods`, checks for existing `billedCosts`, inserts new `billedCosts` entries, and updates `copilotBillingSnapshots.linkedBilledCostId`. The function should end after upserting the billing snapshot.
- [x] T005 [P] [US1] Remove the entire `backfillBilledCosts()` function from `src/lib/copilot-sync.ts` (lines ~513-570). Delete the full exported function and its JSDoc/comments.
- [x] T006 [US1] Remove the `backfillBilledCosts()` call from `runCopilotSync()` in `src/lib/copilot-sync.ts` (lines ~650-655). Delete the try/catch block that calls `backfillBilledCosts(connectionId)`.
- [x] T007 [US1] Clean up unused imports in `src/lib/copilot-sync.ts`. Remove `billedCosts` and `budgetPeriods` from the schema import. Remove `isNull`, `lte`, `gte` from drizzle-orm imports if they are no longer used elsewhere in the file.

**Checkpoint**: Copilot sync pipeline no longer references `billedCosts`, `budgetPeriods`, or `linkedBilledCostId`. Run `pnpm typecheck` to verify zero compile errors.

---

## Phase 4: User Story 2 — Copilot Billing Page Shows All Data Independently (Priority: P1)

**Goal**: Verify the Copilot billing page continues to display all data from snapshots with no regression.

**Independent Test**: Navigate to the Copilot billing page and verify all billing data renders correctly from snapshot data alone, even when no budget periods exist.

### Implementation for User Story 2

- [x] T008 [US2] Verify `getCopilotBilling()` in `src/actions/copilot-data.ts` reads exclusively from `copilotBillingSnapshots` and does not reference `billedCosts` or `budgetPeriods`. No code changes expected — this is a verification task. If any references are found, remove them.
- [x] T009 [US2] Verify the Copilot billing page component in `src/app/copilot/billing/page.tsx` does not reference `billedCosts` or `linkedBilledCostId`. No code changes expected — this is a verification task.

**Checkpoint**: Copilot billing page is confirmed independent of shared billing system.

---

## Phase 5: User Story 3 — Copilot Costs No Longer Appear in Shared Reports (Priority: P2)

**Goal**: Generate a database migration that drops the `linkedBilledCostId` column and cleans up existing Copilot-sourced `billedCosts` entries.

**Independent Test**: After migration, verify the main dashboard KPIs and reports page charts contain zero Copilot-sourced cost entries.

### Implementation for User Story 3

- [x] T010 [US3] Generate a Drizzle migration by running `pnpm db:generate`. This will produce a new migration file in `src/lib/db/migrations/` that drops the `linked_billed_cost_id` column and its index from `copilot_billing_snapshots`.
- [x] T011 [US3] Add a data cleanup SQL statement to the generated migration file in `src/lib/db/migrations/0007_*.sql`. Append `DELETE FROM billed_costs WHERE vendor_reference LIKE 'copilot-billing-%';` to remove Copilot-sourced billing entries. This ensures reports and dashboard KPIs no longer include Copilot cost data.

**Checkpoint**: Migration file handles both schema change and data cleanup. Reports will automatically exclude Copilot data after migration runs.

---

## Phase 6: User Stories 4 & 5 — Seat and Tool Verification (Priority: P2/P3)

**Goal**: Confirm that license assignment sync and AI tool/tier creation are unaffected by the decoupling changes.

**Independent Test**: Run a Copilot sync and verify seats appear on both the Copilot seats page and shared assignments page. Verify the "GitHub Copilot" AI tool and tiers are created/updated.

### Verification for User Stories 4 & 5

- [x] T012 [P] [US4] Verify `syncSeatAssignments()` in `src/lib/copilot-sync.ts` is unchanged and continues to create/update `licenseAssignments` with `source = "copilot-sync"`. No code changes expected.
- [x] T013 [P] [US5] Verify `syncBillingData()` in `src/lib/copilot-sync.ts` still creates/updates the "GitHub Copilot" `aiTools` record and `accessTiers` entries (Business/Enterprise). These sections should remain untouched after the T004 changes.

**Checkpoint**: Seat sync and tool/tier management confirmed unaffected.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation that the entire codebase builds cleanly after all changes.

- [x] T014 Run `pnpm typecheck` to verify zero TypeScript compilation errors across the entire codebase
- [x] T015 Run `pnpm lint` to verify zero ESLint warnings
- [x] T016 Run `pnpm build` to verify production build succeeds

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 2)**: No dependencies — can start immediately
- **US1 (Phase 3)**: Can start in parallel with Phase 2 (different file: `copilot-sync.ts` vs `schema.ts`)
- **US2 (Phase 4)**: Can start in parallel with Phase 2 and Phase 3 (verification only)
- **US3 (Phase 5)**: Depends on Phase 2 completion (migration generation needs schema changes)
- **US4+US5 (Phase 6)**: Can start after Phase 3 (verify sync changes didn't affect seats/tools)
- **Polish (Phase 7)**: Depends on all previous phases

### User Story Dependencies

- **US1 (P1)**: Independent — core sync pipeline changes
- **US2 (P1)**: Independent — verification only, no code changes expected
- **US3 (P2)**: Depends on Phase 2 (schema changes must exist before generating migration)
- **US4 (P2)**: Depends on US1 (verify seat sync unaffected by sync pipeline changes)
- **US5 (P3)**: Depends on US1 (verify tool/tier creation unaffected by sync pipeline changes)

### Parallel Opportunities

- **T001 + T002**: Both modify `schema.ts` but different sections — can be done sequentially in one edit session
- **T004 + T005**: Both modify `copilot-sync.ts` but different functions — can be done in one edit session
- **Phase 2 + Phase 3**: Different files (`schema.ts` vs `copilot-sync.ts`) — can run in parallel
- **T008 + T009**: Different files — can verify in parallel
- **T012 + T013**: Different verification targets — can verify in parallel

---

## Parallel Example: Phase 2 + Phase 3

```bash
# These can run in parallel (different files):
# Agent A: Schema changes in src/lib/db/schema.ts
Task: "T001 Remove linkedBilledCostId column from copilotBillingSnapshots"
Task: "T002 Remove copilot_billing_snapshots_linked_cost_idx index"
Task: "T003 Remove linkedBilledCost relation"

# Agent B: Sync pipeline changes in src/lib/copilot-sync.ts
Task: "T004 Remove budget period lookup from syncBillingData()"
Task: "T005 Remove backfillBilledCosts() function"
Task: "T006 Remove backfillBilledCosts() call from runCopilotSync()"
Task: "T007 Clean up unused imports"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: Schema changes (T001-T003)
2. Complete Phase 3: Sync pipeline decoupling (T004-T007)
3. **STOP and VALIDATE**: Run `pnpm typecheck` — zero errors means decoupling is complete
4. The sync pipeline now works without any budget dependency

### Incremental Delivery

1. Phase 2 + Phase 3 → Core decoupling complete (MVP)
2. Phase 4 → Billing page verified independent
3. Phase 5 → Migration with data cleanup ready for deployment
4. Phase 6 → Seats and tools verified unaffected
5. Phase 7 → Clean build confirmed

---

## Notes

- This feature is primarily a **code removal** task (~100 lines removed, 0 lines added)
- Only 2 source files are modified: `src/lib/db/schema.ts` and `src/lib/copilot-sync.ts`
- 1 migration file is generated and customized
- No UI components are changed
- No new dependencies are added
- Commit after each phase or logical group of tasks
