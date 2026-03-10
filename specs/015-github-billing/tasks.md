# Tasks: GitHub Billing Sync

**Input**: Design documents from `/specs/015-github-billing/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Not explicitly requested — test tasks omitted. Manual verification via quickstart.md.

**Organization**: Tasks grouped by user story. US1 and US2 share a phase since idempotent upsert is integral to the core sync logic.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Schema & Migration)

**Purpose**: Database schema changes and migration generation

- [x] T001 Add `linkedBilledCostId` column to `copilotBillingSnapshots` in `src/lib/db/schema.ts` — nullable integer FK to `billed_costs.id` with `onDelete: "set null"`, plus index `copilot_billing_snapshots_linked_cost_idx`
- [x] T002 Add `billingLinked` and `billingSkipped` nullable integer columns to `githubSyncEvents` in `src/lib/db/schema.ts`
- [x] T003 Add `linkedBilledCost` relation to `copilotBillingSnapshotsRelations` in `src/lib/db/schema.ts` — `one(billedCosts, { fields: [linkedBilledCostId], references: [id] })`
- [x] T004 Generate and apply Drizzle migration via `pnpm db:generate && pnpm db:migrate`

---

## Phase 2: Foundational (Shared Utilities & Types)

**Purpose**: Extract shared code and define types that all user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Extract `findActivePeriodForDate()` from `src/actions/invoices.ts` into new `src/lib/budget-utils.ts` — export the function, update `invoices.ts` to import from new location
- [x] T006 [P] Add `BillingLinkResult` and `BillingSyncConflict` types to `src/types/index.ts` per contracts/server-actions.md — `BillingLinkResult { linked, skipped, conflicts[] }` and `BillingSyncConflict { billingMonth, snapshotAmountCents, manualEntryAmountCents, manualEntryDescription, periodLabel }`
- [x] T007 [P] Add vendor reference helper function `buildCopilotVendorRef(billingMonth: string): string` to `src/lib/budget-utils.ts` — returns `github-billing-copilot-YYYY-MM` format from a billing month date string

**Checkpoint**: Foundation ready — schema migrated, shared utilities available, types defined

---

## Phase 3: User Story 1 + 2 — Core Billing Sync & Idempotent Upsert (Priority: P1) 🎯 MVP

**Goal**: Extend `syncBillingData()` to create/update billed cost entries in matching budget periods using vendor-reference-based upserts. Detect manual entry conflicts and skip them. 12-month backfill on first run.

**Independent Test**: Trigger a Copilot sync, verify billed costs appear in budget periods. Run sync again, verify no duplicates. Manually create a billed cost for a billing month, run sync, verify it's skipped with a conflict logged.

### Implementation

- [x] T008 [US1] Implement `syncBillingToBudget()` in `src/lib/copilot-sync.ts` — new async function that takes `connectionId` and `adminUserId`, fetches up to 12 months of `copilotBillingSnapshots` for the connection, and for each snapshot: (a) calls `findActivePeriodForDate(billingMonth)`, (b) if no period → skip with reason `no_matching_period`, (c) queries `billedCosts` for existing entry with matching `vendorReference`, (d) if found → UPDATE amount/description/updatedAt and call `recordUpdate()`, (e) if not found → check for manual conflict (non-github-billing-* vendorReference in same period with invoiceDate in same month), (f) if conflict → skip with reason `manual_entry_exists`, (g) if clean → INSERT new billedCost and call `recordCreation()`, update snapshot's `linkedBilledCostId`. Return `BillingLinkResult` with counts and conflict details.
- [x] T009 [US1] Integrate `syncBillingToBudget()` into `syncBillingData()` in `src/lib/copilot-sync.ts` — call it after the existing snapshot upsert, passing `connection.id` and `connection.connectedBy`. Store the `BillingLinkResult` to return alongside existing `BillingSyncResult`.
- [x] T010 [US2] Update `runCopilotSync()` in `src/lib/copilot-sync.ts` — after `syncBillingData()` completes, write `billingLinked` and `billingSkipped` counts from `BillingLinkResult` to the `githubSyncEvents` row alongside existing `billingProcessed`, `seatsProcessed`, `metricsProcessed`.
- [x] T011 [US1] Verify `pnpm typecheck` passes with zero errors after all sync changes

**Checkpoint**: Core billing sync works — billed costs created in budget periods, idempotent upserts, conflict detection, backfill. This is the MVP.

---

## Phase 4: User Story 3 — Copilot Dashboard Billing Integration (Priority: P2)

**Goal**: Enhance the Copilot billing dashboard to show budget context (linked period, utilization, conflict indicators) for each billing month.

**Independent Test**: Navigate to `/copilot/billing` after a sync, verify each row shows linked period name or "Unlinked"/"Conflict" badge. Verify linked months show utilization percentage.

### Implementation

- [x] T012 [US3] Implement `getBillingSyncConflicts()` server action in `src/actions/copilot-data.ts` — query copilotBillingSnapshots LEFT JOIN billedCosts (via linkedBilledCostId) to find snapshots where linkedBilledCostId IS NULL but a manual billedCost exists in the matching period. Return `BillingSyncConflict[]` per contract.
- [x] T013 [US3] Extend `getCopilotBilling()` in `src/actions/copilot-data.ts` — LEFT JOIN copilotBillingSnapshots to billedCosts (via linkedBilledCostId), then LEFT JOIN to budgetPeriods (via billedCosts.periodId). Add `linkedBilledCostId`, `linkedPeriodLabel`, `linkedPeriodUtilization` (calculated: sum of period's billedCosts / plannedAmountCents * 100), and `linkStatus` ("linked" | "unlinked" | "conflict") to each billing row.
- [x] T014 [US3] Update `getCopilotSyncStatus()` in `src/actions/copilot.ts` — add `linkedBillingMonths` count to `recordCounts` by querying copilotBillingSnapshots WHERE linkedBilledCostId IS NOT NULL.
- [x] T015 [US3] Update Copilot billing page `src/app/copilot/billing/page.tsx` — add "Budget Period" column to billing table showing linked period label. Add link status badge using shadcn Badge component: green "Linked" with period name, yellow "Unlinked" with tooltip "No matching budget period", red "Conflict" with tooltip showing manual entry description. Add utilization percentage next to linked period name.

**Checkpoint**: Copilot billing dashboard shows full budget context for every billing month

---

## Phase 5: User Story 4 — Manual Sync Trigger & Status Visibility (Priority: P2)

**Goal**: Add a "Sync Billing Now" button to the Copilot billing page with progress indication and sync history showing billing-specific metrics.

**Independent Test**: Click "Sync Billing Now" on `/copilot/billing`, see progress spinner, then see updated sync history with billing linked/skipped counts.

### Implementation

- [x] T016 [US4] Add billing sync trigger button to `src/app/copilot/billing/page.tsx` — shadcn Button with Lucide `RefreshCw` icon, calls existing `triggerCopilotSync()` action, shows loading spinner during sync, displays Sonner toast on completion with linked/skipped counts.
- [x] T017 [US4] Add sync history section to `src/app/copilot/billing/page.tsx` — query recent `githubSyncEvents` (syncType="copilot", limit 10), display as a compact table with columns: timestamp, status badge (completed/partial/failed), billing months processed, entries linked, entries skipped, error message (truncated with expand).
- [x] T018 [US4] Implement `getCopilotBillingSyncHistory()` server action in `src/actions/copilot-data.ts` — query `githubSyncEvents` WHERE syncType="copilot" ORDER BY startedAt DESC LIMIT 10, returning id, startedAt, completedAt, status, billingProcessed, billingLinked, billingSkipped, errorMessage.

**Checkpoint**: Administrators can manually trigger sync and review history with billing-specific metrics

---

## Phase 6: User Story 5 — Scheduled Automatic Billing Sync (Priority: P3)

**Goal**: Ensure the existing `/api/copilot/sync` cron endpoint includes billing-to-budget linking automatically. No new endpoint needed — the sync pipeline already runs via cron.

**Independent Test**: Call `POST /api/copilot/sync` with `Authorization: Bearer $CRON_SECRET`, verify billing data is synced and linked to budget periods.

### Implementation

- [x] T019 [US5] Verify cron endpoint `src/app/api/copilot/sync/route.ts` automatically picks up billing linking — since T009 integrated `syncBillingToBudget()` into `syncBillingData()`, the cron endpoint requires no changes. Verify by reading the file and confirming it calls `runCopilotSync()` which calls `syncBillingData()`.
- [x] T020 [US5] Add billing linking metrics to cron response in `src/app/api/copilot/sync/route.ts` — extend the JSON response to include `billingLinked` and `billingSkipped` from the sync event, so external monitoring can track billing sync health.

**Checkpoint**: Scheduled syncs automatically include billing-to-budget linking with observable metrics

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, type safety, and code quality

- [x] T021 Run `pnpm typecheck` to verify zero TypeScript compilation errors
- [x] T022 Run `pnpm lint` to verify zero ESLint warnings
- [x] T023 [P] Verify `src/actions/invoices.ts` still works after `findActivePeriodForDate` extraction — check imports resolve correctly
- [x] T024 [P] Verify main dashboard KPIs include Copilot billed costs — navigate to main dashboard after sync and confirm totals include GitHub Copilot spending from linked budget periods (FR-007)
- [x] T025 Run quickstart.md validation — follow all manual test steps in `specs/015-github-billing/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (schema must exist for type inference)
- **US1+US2 (Phase 3)**: Depends on Phase 2 (needs shared utilities and types)
- **US3 (Phase 4)**: Depends on Phase 3 (needs linked snapshots to display)
- **US4 (Phase 5)**: Depends on Phase 3 (needs sync pipeline to trigger)
- **US5 (Phase 6)**: Depends on Phase 3 (needs sync pipeline changes)
- **Polish (Phase 7)**: Depends on all previous phases

### User Story Dependencies

- **US1+US2 (P1)**: Start after Foundational — core sync pipeline, no other story dependencies
- **US3 (P2)**: Depends on US1+US2 — needs linked billed costs and snapshots to display
- **US4 (P2)**: Depends on US1+US2 — needs sync pipeline to trigger and track
- **US3 and US4**: Can run in parallel with each other after US1+US2 completes
- **US5 (P3)**: Depends on US1+US2 — verify cron picks up changes. Can run in parallel with US3/US4

### Within Each User Story

- Schema before utilities
- Utilities before sync logic
- Sync logic before dashboard queries
- Dashboard queries before UI components
- Commit after each task or logical group

### Parallel Opportunities

- T006 and T007 can run in parallel (different files, no dependencies)
- T012 and T014 can run in parallel (different files in copilot-data.ts vs copilot.ts)
- US3, US4, US5 can all start in parallel after US1+US2 completes
- T021, T022, T023, T024 can run in parallel in the polish phase

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Sequential (T005 must complete first):
Task T005: "Extract findActivePeriodForDate to src/lib/budget-utils.ts"

# Then parallel:
Task T006: "Add BillingLinkResult and BillingSyncConflict types to src/types/index.ts"
Task T007: "Add buildCopilotVendorRef helper to src/lib/budget-utils.ts"
```

## Parallel Example: After US1+US2 Completes

```bash
# All three story phases can start in parallel:
Phase 4 (US3): "Copilot dashboard billing integration"
Phase 5 (US4): "Manual sync trigger and status visibility"
Phase 6 (US5): "Scheduled automatic billing sync verification"
```

---

## Implementation Strategy

### MVP First (US1 + US2 Only)

1. Complete Phase 1: Setup (T001-T004)
2. Complete Phase 2: Foundational (T005-T007)
3. Complete Phase 3: US1+US2 (T008-T011)
4. **STOP and VALIDATE**: Run sync, verify billed costs in budget periods, verify idempotency
5. Deploy/demo if ready — core value delivered

### Incremental Delivery

1. Setup + Foundational → Schema migrated, utilities ready
2. US1+US2 → Billing sync works with upserts and conflict detection (MVP!)
3. US3 → Dashboard shows budget context → Deploy/Demo
4. US4 → Manual trigger with history → Deploy/Demo
5. US5 → Cron picks up changes automatically → Deploy/Demo
6. Polish → Final validation → Release

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- US1 and US2 share Phase 3 because idempotent upsert is integral to the core sync — they cannot be implemented independently
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- The vendor reference format `github-billing-copilot-YYYY-MM` is extensible for future products
