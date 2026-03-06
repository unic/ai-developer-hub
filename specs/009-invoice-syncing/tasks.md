# Tasks: Invoice-to-Budget Period Sync

**Input**: Design documents from `/specs/009-invoice-syncing/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/sync-invoices-action.md, quickstart.md

**Tests**: Unit and integration tests are included per the constitution (Principle I: unit test coverage for business logic) and plan.md (which lists test files).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add shared types and validation schemas needed by all user stories

- [ ] T001 [P] Add `SyncInvoiceOutcome` and `SyncResult` TypeScript types in `src/types/index.ts` — define outcome enum (`"verified" | "newly_linked" | "corrected" | "unresolvable" | "error"`), per-invoice outcome type (invoiceId, invoiceNumber, invoiceDate, amountCents, vendor, outcome, previousPeriodLabel, newPeriodLabel, reason), and aggregate result type (totalProcessed, verified, newlyLinked, corrected, unresolvable, errors, items)
- [ ] T002 [P] Add Zod schemas for sync types in `src/lib/validators.ts` — add `syncOptionsSchema` (`{ dryRun: z.boolean() }`), `syncInvoiceOutcomeSchema`, and `syncResultSchema` matching the TypeScript types from T001

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core sync matching logic that MUST be complete before any user story UI can work

**CRITICAL**: No user story work can begin until this phase is complete

- [ ] T003 Create `src/actions/invoice-sync.ts` with `"use server"` directive, imports (db, schema tables, drizzle operators, requireAdmin, recordCreation, revalidatePath, Zod schemas), and the `findPeriodForDate` function — similar to existing `findActivePeriodForDate` in `src/actions/invoices.ts` but removes the `eq(annualBudgets.status, "active")` filter, instead ordering by `CASE WHEN status = 'active' THEN 0 ELSE 1 END ASC` then `annualBudgets.createdAt DESC`, so active budgets are preferred over archived ones
- [ ] T004 Implement the core `syncInvoices({ dryRun: boolean })` server action in `src/actions/invoice-sync.ts` with the following logic: (1) requireAdmin check, (2) validate input with syncOptionsSchema, (3) bulk-load all invoices with their linked billed cost's period via left joins (invoices → billedCosts → budgetPeriods), (4) bulk-load all budget periods with parent budget status, (5) for each invoice: use in-memory matching to find correct period via `findPeriodForDate`, categorize as verified/newly_linked/corrected/unresolvable, (6) if not dryRun: execute per-invoice mutations in individual `db.transaction()` calls — newly_linked: insert billedCost + update invoice.linkedBilledCostId; corrected: delete old billedCost + insert new + update link; (7) on per-invoice error: catch, mark as "error" outcome, continue to next invoice (FR-008), (8) build description as `"Invoice {num} — {vendor}"` or `"Invoice {num}"` with vendorReference = invoiceNumber (matching existing format from insertBilledCostDirect), (9) record history via recordCreation for new billed costs, (10) call revalidatePath("/invoices") after all mutations, (11) return ActionResult<SyncResult> with aggregate counts and per-invoice items

**Checkpoint**: Sync engine is functional and can be called programmatically. All matching and mutation logic is testable.

---

## Phase 3: User Story 1 — Run Full Invoice Sync (Priority: P1) MVP

**Goal**: Admin can trigger sync that scans all invoices and corrects budget period links

**Independent Test**: Upload invoices (some linked, some not, some mislinked), trigger sync, verify all outcomes are correct in the database

### Tests for User Story 1

- [ ] T005 [P] [US1] Write unit tests for `findPeriodForDate` in `tests/unit/invoice-sync.test.ts` — test cases: (1) invoice date within active budget period returns that period, (2) invoice date within archived budget period returns that period, (3) invoice date matching both active and archived prefers active, (4) invoice date outside all periods returns null, (5) multiple archived budgets prefers most recently created, (6) date on period boundary (startDate inclusive, endDate exclusive)
- [ ] T006 [P] [US1] Write unit tests for sync categorization logic in `tests/unit/invoice-sync.test.ts` — test cases: (1) unlinked invoice with matching period → newly_linked, (2) correctly linked invoice → verified, (3) invoice linked to wrong period → corrected, (4) unlinked invoice with no matching period → unresolvable, (5) dry run produces same categorizations but no DB mutations
- [ ] T007 [US1] Write integration tests for `syncInvoices` in `tests/integration/invoice-sync.test.ts` — seed DB with budgets (active + archived), periods, and invoices (mix of linked/unlinked/mislinked), call syncInvoices({ dryRun: false }), verify: (1) previously unlinked invoices now have linkedBilledCostId, (2) mislinked invoices have new billedCost in correct period and old billedCost is deleted, (3) correctly linked invoices unchanged, (4) result counts match actual DB state, (5) calling sync again produces all "verified" with zero mutations

**Checkpoint**: Sync engine is fully tested. All acceptance scenarios from US1 are covered.

---

## Phase 4: User Story 2 — View Sync Results Summary (Priority: P1)

**Goal**: After sync completes, admin sees a dialog with categorized results (verified, newly linked, corrected, unresolvable) and per-invoice details

**Independent Test**: Trigger sync and verify the results dialog shows correct counts and per-invoice details including invoice number, date, amount, vendor, previous/new period labels

### Implementation for User Story 2

- [ ] T008 [US2] Create sync results dialog component in `src/app/invoices/sync-results-dialog.tsx` — a `"use client"` component using shadcn/ui Dialog (Radix-based for accessibility). Props: `open: boolean`, `onOpenChange`, `result: SyncResult | null`, `isDryRun: boolean`. Content: (1) header showing "Sync Results" or "Sync Preview (Dry Run)", (2) summary section with Badge components showing counts for each category (verified=green, newly_linked=blue, corrected=amber, unresolvable=red, errors=red), (3) scrollable Table showing per-invoice details: invoice number, invoice date, amount (formatted as currency from cents), vendor, outcome Badge, previous period label (or "—" if unlinked), new period label (or "—" if unresolvable), reason column for unresolvable/error items, (4) footer with Close button, and if isDryRun: "Apply Changes" Button that calls an onConfirm callback

**Checkpoint**: Results dialog can render any SyncResult data. Independently testable with mock data.

---

## Phase 5: User Story 3 — Sync Entry Point in Invoice Management (Priority: P2)

**Goal**: Admin sees a "Sync Invoices" button on the invoice listing page that triggers sync and shows results

**Independent Test**: Navigate to /invoices, click "Sync Invoices", verify loading state appears, sync runs, and results dialog opens

### Implementation for User Story 3

- [ ] T009 [US3] Create sync button client component in `src/app/invoices/sync-invoices-button.tsx` — a `"use client"` component with: (1) "Sync Invoices" Button (shadcn/ui, variant="outline") with RefreshCw icon from Lucide, (2) React state: `isSyncing`, `result`, `showResults`, `isDryRun`, (3) onClick: set isSyncing=true, call `syncInvoices({ dryRun: false })`, set result and showResults on completion, set isSyncing=false, show toast on error via Sonner, (4) button disabled with Loader2 spinner animation while isSyncing (prevents concurrent syncs per FR-009), (5) renders SyncResultsDialog with result data and open/close state
- [ ] T010 [US3] Modify `src/app/invoices/page.tsx` to import and render `SyncInvoicesButton` in the header actions div alongside existing "Bulk Upload" and "Upload Invoice" buttons — place it as the first button in the flex container (before Bulk Upload)

**Checkpoint**: Full sync flow works end-to-end: click button → see loading → see results dialog. Independently testable by visiting /invoices.

---

## Phase 6: User Story 4 — Dry Run Preview (Priority: P3)

**Goal**: Admin can preview sync changes before committing, then choose to apply or cancel

**Independent Test**: Click dry run, verify no DB changes, review preview, click "Apply Changes", verify changes are applied

### Implementation for User Story 4

- [ ] T011 [US4] Extend `src/app/invoices/sync-invoices-button.tsx` to add dry run support — add a DropdownMenu (shadcn/ui) triggered by a ChevronDown split-button or secondary action next to the main "Sync Invoices" button. Menu items: "Preview Changes (Dry Run)" and "Sync Now". "Preview Changes" calls `syncInvoices({ dryRun: true })`, sets isDryRun=true, shows results dialog. The "Apply Changes" button in the results dialog (visible only when isDryRun=true) calls `syncInvoices({ dryRun: false })` and updates the displayed results. Cancel just closes the dialog with no mutations.

**Checkpoint**: Dry run flow works: preview → review → apply or cancel. SC-006 verified by comparing dry run and actual results.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and cleanup

- [ ] T012 Run `pnpm typecheck` and fix any TypeScript strict mode errors across all new/modified files
- [ ] T013 Run `pnpm lint` and fix any ESLint warnings across all new/modified files
- [ ] T014 [P] Verify accessibility: results dialog is keyboard-navigable, focus trapped in dialog, Escape closes, ARIA labels on all interactive elements, Badge text is readable (not color-only), table uses semantic markup
- [ ] T015 Manually test full flow: upload invoices without budget → create budget → sync → verify links created → modify invoice dates → sync again → verify corrections → test with archived budget → verify dry run matches actual

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (types and schemas) — BLOCKS all user stories
- **US1 Tests (Phase 3)**: Depends on Phase 2 (sync action exists to test)
- **US2 Results Dialog (Phase 4)**: Depends on Phase 1 (SyncResult type) — can start in parallel with Phase 3
- **US3 Button + Page (Phase 5)**: Depends on Phase 2 (sync action) and Phase 4 (results dialog)
- **US4 Dry Run (Phase 6)**: Depends on Phase 5 (button component to extend)
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Tests only — depends on Foundational (Phase 2)
- **User Story 2 (P1)**: Results dialog — depends only on types (Phase 1), can be built in parallel with US1 tests
- **User Story 3 (P2)**: Depends on US2 (dialog component) and Phase 2 (sync action)
- **User Story 4 (P3)**: Depends on US3 (button component to extend)

### Within Each Phase

- Tasks marked [P] can run in parallel
- T001 and T002 are parallel (different files)
- T005 and T006 are parallel (same file but independent test suites)
- T003 must complete before T004 (findPeriodForDate used by syncInvoices)

### Parallel Opportunities

```
Phase 1: T001 ║ T002  (parallel — different files)
Phase 2: T003 → T004  (sequential — dependency)
Phase 3: T005 ║ T006  (parallel — independent tests)
         T007          (sequential — needs sync action + DB)
Phase 4: T008          (can start alongside Phase 3)
Phase 5: T009 → T010   (sequential — button before page integration)
Phase 6: T011          (sequential — extends button)
Phase 7: T012 → T013 → T014 ║ T015
```

---

## Parallel Example: Phases 3 + 4

```bash
# These can run in parallel since they touch different files:
# Agent A (Phase 3 - Tests):
Task: "Unit tests for findPeriodForDate in tests/unit/invoice-sync.test.ts"
Task: "Unit tests for sync categorization in tests/unit/invoice-sync.test.ts"
Task: "Integration tests for syncInvoices in tests/integration/invoice-sync.test.ts"

# Agent B (Phase 4 - Results Dialog):
Task: "Create sync results dialog in src/app/invoices/sync-results-dialog.tsx"
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2 + 3)

1. Complete Phase 1: Setup (types + schemas)
2. Complete Phase 2: Foundational (sync engine)
3. Complete Phase 3: US1 tests (validate engine)
4. Complete Phase 4: US2 results dialog (can parallel with Phase 3)
5. Complete Phase 5: US3 button + page integration
6. **STOP and VALIDATE**: Sync works end-to-end with results display
7. Deploy/demo MVP

### Incremental Delivery

1. Setup + Foundational → Engine ready
2. Add US1 tests → Engine validated
3. Add US2 results dialog → Visual feedback ready
4. Add US3 button + page → MVP complete, deployable
5. Add US4 dry run → Safety preview added
6. Polish → Production ready

### Notes

- US1 and US2 are both P1 but US2 (dialog) is pure UI and can be built alongside US1 (tests)
- US3 is the integration point that connects engine + dialog to the page
- US4 is incremental on top of US3 — minimal code change (add dropdown + dry run flag)
- No schema changes means no migration risk
- Sync is idempotent — safe to run repeatedly during development
