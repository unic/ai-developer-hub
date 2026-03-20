# Tasks: Invoice Automations & Running Cost Visibility

**Input**: Design documents from `specs/019-invoice-automations/`
**Branch**: `019-invoice-automations`
**Spec**: `specs/019-invoice-automations/spec.md`
**Plan**: `specs/019-invoice-automations/plan.md`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no shared dependencies on in-progress tasks)
- **[Story]**: Which user story this task belongs to (US1–US6)
- Exact file paths included in every task description

---

## Phase 1: Setup

**Purpose**: Create new directory structure and update shared config before any implementation begins.

- [x] T001 Create `src/lib/sync/` directory with subdirectories `sources/` — add empty `.gitkeep` files so the structure is committed
- [x] T002 [P] Update `.env.example` — add `INVOICE_INGEST_SECRET=` with comment: `# Bearer token for POST /api/invoices/ingest (external automation ingestion endpoint)`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema changes, migration, and the sync framework core that ALL user stories depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. Migration must apply cleanly against the production DB.

- [x] T003 Update `src/lib/db/schema.ts` — add three new enums: `syncSourceTypeEnum` (values: `github_copilot_billing`, `anthropic_api_usage`, `anthropic_team_invoices`, `github_members`, `invoice_period_matching`, `anthropic_workspace_sync`); `syncOutcomeEnum` (values: `in_progress`, `success`, `partial`, `failed`); `syncOperationTypeEnum` (values: `regular`, `backfill`). Add `syncSources` table (columns: `id` serial PK, `sourceType` syncSourceTypeEnum UNIQUE NOT NULL, `enabled` boolean NOT NULL DEFAULT true, `cronSchedule` varchar(100) nullable, `createdAt` timestamp DEFAULT now(), `updatedAt` timestamp DEFAULT now()). Add `syncEvents` table (columns: `id` serial PK, `sourceType` syncSourceTypeEnum NOT NULL, `operationType` syncOperationTypeEnum NOT NULL DEFAULT `regular`, `backfillStartDate` date nullable, `outcome` syncOutcomeEnum NOT NULL DEFAULT `in_progress`, `startedAt` timestamp NOT NULL DEFAULT now(), `completedAt` timestamp nullable, `triggeredBy` integer FK → users(id) nullable, `createdCount` integer NOT NULL DEFAULT 0, `updatedCount` integer NOT NULL DEFAULT 0, `skippedCount` integer NOT NULL DEFAULT 0, `errorCount` integer NOT NULL DEFAULT 0, `errorMessage` text nullable, `createdAt` timestamp NOT NULL DEFAULT now()); add indexes on `sourceType`, `outcome`, `startedAt DESC`, `(sourceType, startedAt DESC)`. Also alter `billedCosts.vendorReference` to NOT NULL with default `''`

- [x] T004 Write Drizzle migration SQL in `src/lib/db/migrations/` — after running `pnpm db:generate`, hand-edit the generated file to embed the following data migration steps (all wrapped in a single transaction): (1) INSERT INTO sync_events SELECT from `github_sync_events` mapping `sync_type` → `source_type` (copilot→github_copilot_billing, members→github_members) and `status` → `outcome` (completed→success, partial→partial, failed→failed, in_progress→in_progress), mapping `billing_linked` → `created_count`, `billing_skipped` → `skipped_count`, keeping `triggered_by`, `started_at`, `completed_at`, `error_message`; (2) INSERT INTO sync_events SELECT from `anthropic_sync_status` WHERE `user_id = 0` mapping `last_sync_error IS NOT NULL` → failed, `last_sync_completed_at IS NOT NULL` → success, else → in_progress, source_type = anthropic_api_usage; (3) INSERT INTO sync_events SELECT from `anthropic_sync_status` WHERE `user_id = -1` mapping `workspace_sync_completed_at` as `completed_at`, source_type = anthropic_workspace_sync; (4) INSERT INTO sync_sources VALUES for all 6 source types with schedules (github_copilot_billing:'0 6 * * *', anthropic_api_usage:'0 * * * *', anthropic_team_invoices:NULL, github_members:NULL, invoice_period_matching:NULL, anthropic_workspace_sync:'0 * * * *'); (5) UPDATE billed_costs SET vendor_reference='' WHERE vendor_reference IS NULL; (6) DROP TABLE github_sync_events; DROP TABLE anthropic_sync_status; DROP TYPE github_sync_status; DROP TYPE copilot_sync_type

- [x] T005 Apply migration — run `pnpm db:migrate` to deploy schema and data migration to the dev/staging DB; verify row counts (SELECT COUNT(*) FROM sync_events; SELECT COUNT(*) FROM sync_sources) match expectations before proceeding

- [x] T006 [P] Implement `src/lib/sync/framework.ts` — export `hashSourceType(sourceType: SyncSourceType): bigint` using FNV-32 hash of the string → stable bigint advisory lock ID; export `retryWithBackoff<T>(fn: () => Promise<T>, opts?: { maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number }): Promise<T>` with defaults maxRetries:3, baseDelay:1000ms, maxDelay:8000ms, jitter up to 500ms; export `withSyncLock(params: { sourceType, triggeredBy?: number, operationType?: SyncOperationType, backfillStartDate?: Date }, fn: (eventId: number) => Promise<SyncCounts>): Promise<void>` — acquires `pg_try_advisory_lock(hash)`, throws "Sync already in progress" if lock not acquired, inserts `sync_events` row with outcome='in_progress', calls fn(eventId), on success sets outcome from returned counts (success/partial based on errorCount), on error sets outcome='failed' with error_message (no stack trace), always releases lock in finally; export `updateSyncEvent(id: number, patch: Partial<SyncEventUpdate>)` internal helper

- [x] T007 [P] Implement `src/lib/sync/registry.ts` — export `getSyncSources(): Promise<SyncSourceWithLastEvent[]>` — queries `sync_sources` LEFT JOIN latest `sync_events` per source_type using a subquery `SELECT DISTINCT ON (source_type) * FROM sync_events ORDER BY source_type, started_at DESC`; maps to typed `SyncSourceWithLastEvent` shape matching the `SyncSourceStatus` contract in `specs/019-invoice-automations/contracts/api-contracts.md`; export `getSyncSource(type: SyncSourceType): Promise<SyncSource | null>`

**Checkpoint**: Schema deployed, framework functions compiled — user story phases can now proceed.

---

## Phase 3: User Story 1 — Unified Sync Framework (Priority: P1) 🎯 MVP

**Goal**: All 5 existing sync mechanisms (+ the 018 workspace sync = 6 total) are unified under a single framework with consistent locking, event logging, and observability.

**Independent Test**: Trigger any sync type (e.g., invoice-matching manually) and verify a `sync_events` row is created with consistent fields. Verify `SELECT * FROM sync_sources` returns 6 rows. Verify two simultaneous calls to the same source return "sync already in progress" for the second.

- [x] T008 [P] [US1] Create `src/lib/sync/sources/github-copilot.ts` — extract core billing sync logic from `src/lib/copilot-sync.ts`; export `run(triggeredBy: number | undefined, opts?: { force?: boolean }): Promise<void>` that wraps execution in `withSyncLock({ sourceType: 'github_copilot_billing', triggeredBy, operationType: 'regular' }, async (eventId) => { ... })` and returns `SyncCounts`; preserve existing `copilotBillingSnapshots` upsert logic and `syncBillingToBudget()` call; replace the existing atomic-INSERT concurrency guard with the framework lock; report `createdCount`, `updatedCount`, `skippedCount` via `updateSyncEvent`

- [x] T009 [P] [US1] Create `src/lib/sync/sources/anthropic-usage.ts` — extract core usage sync logic from `src/lib/anthropic-sync.ts`; export `run(triggeredBy, opts?)` wrapping in `withSyncLock({ sourceType: 'anthropic_api_usage', ... })`; replace `userId = 0` sentinel-row locking with the framework advisory lock; remove the sentinel row read/write from the sync path; preserve `fetchAnthropicUsage`, `resolveModelPricing`, `computeCostCents`, and `anthropicUsageMetrics` upsert logic; wrap external API calls in `retryWithBackoff`

- [x] T010 [P] [US1] Create `src/lib/sync/sources/github-members.ts` — extract member sync logic from `src/actions/github-sync.ts`; export `run(triggeredBy, opts?)` wrapping in `withSyncLock({ sourceType: 'github_members', ... })`; preserve GitHub API fetch, user matching, `githubProfiles` upsert logic; report `createdCount` (new users), `updatedCount` (matched users), `skippedCount` (unmatched)

- [x] T011 [P] [US1] Create `src/lib/sync/sources/invoice-matching.ts` — extract matching logic from `src/actions/invoice-sync.ts`; export `run(triggeredBy, opts?: { dryRun?: boolean })` wrapping in `withSyncLock({ sourceType: 'invoice_period_matching', ... })`; replace `pg_try_advisory_lock(839271456)` with the framework lock (uses `hashSourceType('invoice_period_matching')` internally); preserve dry-run mode and `syncInvoices` logic; report created/updated/skipped/error counts

- [x] T012 [P] [US1] Create `src/lib/sync/sources/anthropic-workspace.ts` — extract workspace sync logic from `src/lib/anthropic-workspace-sync.ts`; export `run(triggeredBy, opts?: { month?: string })` wrapping in `withSyncLock({ sourceType: 'anthropic_workspace_sync', ... })`; replace `userId = -1` sentinel row locking with the framework advisory lock (remove all `anthropicSyncStatus` reads/writes from this file); remove the 50-minute cooldown guard (advisory lock handles mutual exclusion); preserve `fetchAndUpsertWorkspaces()` and `fetchAndUpsertWorkspaceCosts()` functions verbatim; report `workspacesUpserted` as `createdCount`, `costRowsUpserted` as `updatedCount`; keep cache revalidation calls (`revalidateTag`, `revalidatePath`) after successful sync

- [x] T013 [US1] Create `src/actions/sync.ts` — export `triggerSync(sourceType: SyncSourceType): Promise<SyncActionResult>` with `requireAdmin()` check, validates source exists and is enabled in `sync_sources`, routes to the correct source `run()` function; export `triggerBackfill(sourceType: SyncSourceType, startDate: string): Promise<SyncActionResult>` with admin check, Zod validation of `startDate` (ISO date, not future, not more than 24 months ago), only allowed for `github_copilot_billing`, `anthropic_api_usage`, `anthropic_workspace_sync`; export `getSyncStatus(): Promise<SyncStatusResult>` calling `getSyncSources()` from registry

- [x] T014 [P] [US1] Create `src/app/api/sync/github-copilot/route.ts` — export `GET` and `POST` handlers; call `requireCronSecret(request)` first; on auth failure return 401; call `githubCopilotSource.run(undefined)` wrapped in try/catch; on "sync already in progress" error return `{ ok: false, reason: 'sync_in_progress' }` with status 200; on success return `{ ok: true, eventId }`; on other error return `{ ok: false, reason: error.message }` with status 200 (never 5xx to Vercel cron)

- [x] T015 [P] [US1] Create `src/app/api/sync/anthropic-usage/route.ts` — same pattern as T014; calls `anthropicUsageSource.run(undefined)`; returns `{ ok: true, eventId }` on success

- [x] T016 [P] [US1] Create `src/app/api/sync/anthropic-workspace/route.ts` — same pattern; calls `anthropicWorkspaceSource.run(undefined)`; returns `{ ok: true, workspacesUpserted, costRowsUpserted }` on success (pull counts from the resolved sync event)

- [x] T017 [US1] Update `vercel.json` — replace `"/api/copilot/sync"` with `"/api/sync/github-copilot"` (keep schedule `"0 6 * * *"`); replace `"/api/anthropic/sync"` with `"/api/sync/anthropic-usage"` (change schedule from `"*/10 * * * *"` to `"0 * * * *"`); replace `"/api/anthropic/workspace-sync"` with `"/api/sync/anthropic-workspace"` (keep schedule `"0 * * * *"`)

- [x] T018 [US1] Delete retired route files: `src/app/api/copilot/sync/route.ts`, `src/app/api/anthropic/sync/route.ts`, `src/app/api/anthropic/workspace-sync/route.ts` — confirm new routes in T014–T016 compile and respond correctly before deletion; verify no other files import these paths

**Checkpoint**: All 6 sync sources registered in `sync_sources`. Any sync triggered via `triggerSync()` produces a `sync_events` row. Concurrent calls to the same source are rejected. Vercel cron paths updated.

---

## Phase 4: User Story 2 — GitHub Copilot Invoice Auto-Sync (Priority: P2)

**Goal**: Copilot billing records are automatically imported as idempotent `billed_costs` entries linked to the correct budget period, with correct deduplication and amount-correction behavior.

**Independent Test**: Trigger the Copilot billing sync. Confirm `billed_costs` entries appear linked to the correct `budget_periods`. Trigger again — confirm zero new rows created (idempotency). Manually change `total_cost_cents` on a `copilot_billing_snapshots` row to simulate a source correction, re-trigger sync, confirm the linked `billed_costs.amount_cents` is updated in place.

- [ ] T019 [P] [US2] In `src/lib/sync/sources/github-copilot.ts` — ensure `billed_costs` entries are created with `vendor_reference = 'github-billing-copilot-YYYY-MM'`; implement amount-correction update: when `copilot_billing_snapshots.linked_billed_cost_id` already exists and the fetched `totalCostCents` differs from the stored `billed_costs.amount_cents`, issue an `UPDATE billed_costs SET amount_cents = newAmount WHERE id = linkedBilledCostId` (no new row); increment `updatedCount` in the sync event for corrected entries

- [ ] T020 [US2] In `src/lib/sync/sources/github-copilot.ts` — implement unlinked record handling: when `findActivePeriodForDate(billingMonth)` returns null, store the `copilot_billing_snapshots` row with `linked_billed_cost_id = null`; increment `skippedCount` in the sync event (not `errorCount`); include the count of unlinked records in `error_message` as a human-readable summary (e.g., "2 billing records could not be linked to a budget period")

**Checkpoint**: Copilot billing sync creates linked billed costs, updates on correction, stores unlinked records, and produces zero duplicates on re-run.

---

## Phase 5: User Story 3 — Claude Team Plan Invoice Ingestion (Priority: P3)

**Goal**: External automations (email forwarding, scripts) can submit Claude Team Plan PDF invoices to an authenticated endpoint and get the same extraction + dedup + period-linking as the manual upload UI.

**Independent Test**: Submit a Claude Team Plan PDF via `curl -X POST /api/invoices/ingest -H "Authorization: Bearer ..." -F "invoice=@invoice.pdf"`. Confirm 200 response with invoice data and linked period. Submit same PDF again — confirm 409 with `existingInvoiceId`. Submit with no auth header — confirm 401.

- [ ] T021 [US3] Create `src/app/api/invoices/ingest/route.ts` — POST-only handler; read `Authorization` header and validate `Bearer {INVOICE_INGEST_SECRET}` (return 401 `{ success: false, error: "Unauthorized" }` if missing/invalid; return 500 with clear message if `INVOICE_INGEST_SECRET` env var is unset); parse `multipart/form-data` request; extract `invoice` file field; reject with 400 if no file or file > 10 MB; reject with 400 if content-type is not `application/pdf`

- [ ] T022 [US3] Complete `src/app/api/invoices/ingest/route.ts` — call `extractInvoiceFields(pdfBuffer)` from the existing extraction library; on extraction failure return 422 `{ success: false, error: "Could not extract required fields from the provided PDF" }`; call `checkInvoiceDuplicate(invoiceNumber)` — on duplicate return 409 `{ success: false, error: "Invoice {number} already exists", data: { existingInvoiceId } }`; on success: upload PDF to R2 using existing `uploadToR2()` helper; insert row into `invoices` table with `vendor_reference = 'anthropic-team-inv-{invoiceNumber}'`; call `findActivePeriodForDate(invoiceDate)` — if period found, insert `billed_costs` entry with `period_id` and `vendor_reference`; update `invoices.linked_billed_cost_id`; return 200 `{ success: true, data: { invoiceId, invoiceNumber, invoiceDate, amountCents, vendor, action: 'created' | 'created_unlinked', linkedPeriodId?, linkedPeriodLabel? } }`

**Checkpoint**: External automation can submit a PDF and receive identical outcome to manual upload. Duplicate detection works. Auth rejection works.

---

## Phase 6: User Story 4 — Claude API Running Costs in Budget View (Priority: P4)

**Goal**: Budget period detail view shows a visually distinct "Running Costs" section sourced from authoritative `anthropic_workspace_costs` data (018), alongside regular billed costs, with separate totals.

**Independent Test**: Navigate to any budget period that overlaps a month with `anthropic_workspace_costs` data. Confirm a "Running Costs" section appears, showing a value different from the billed costs section, with a "last updated" timestamp. Navigate to a period with no workspace cost data — confirm no "Running Costs" section appears.

- [ ] T023 [P] [US4] Add `getRunningCostsForPeriod(periodId: number): Promise<PeriodRunningCosts | null>` to `src/actions/anthropic-usage.ts` — first query `budget_periods` to get `start_date` and `end_date` for the period; then run `SELECT SUM(cost_cents) AS running_cost_cents, MAX(updated_at) AS last_updated_at FROM anthropic_workspace_costs WHERE date >= startDate AND date <= endDate`; if result is null or 0 return null (zero-value omission per spec); also run optional per-workspace breakdown `SELECT w.name, SUM(c.cost_cents) FROM anthropic_workspace_costs c LEFT JOIN anthropic_workspaces w ON c.workspace_id IS NOT DISTINCT FROM w.workspace_id WHERE c.date >= startDate AND c.date <= endDate GROUP BY w.name` and include in result only when >1 workspace; return typed `PeriodRunningCosts` matching the contract in `specs/019-invoice-automations/contracts/api-contracts.md`

- [ ] T024 [US4] Update the budget period detail Server Component (find the existing page at `src/app/(dashboard)/budget/[id]/page.tsx` or equivalent) — add call to `getRunningCostsForPeriod(period.id)`; pass result as `runningCosts` prop to the period detail UI component

- [ ] T025 [P] [US4] Update the budget period detail UI component — add a "Running Costs" section rendered only when `runningCosts !== null`; use a distinct visual label ("Running Costs", not "Billed"); display `runningCosts.runningCostCents` formatted as currency; show "last updated: {date}" inline using `runningCosts.lastUpdatedAt`; if `runningCosts.workspaceBreakdown` is present and has >1 entry, render a nested list of workspace names and amounts; use shadcn/ui components throughout, consistent with existing billed costs section styling

- [ ] T026 [US4] Update period totals in the budget period detail UI component — add three summary rows: "Billed Total" (sum of `billed_costs` entries), "Running Total" (`runningCosts.runningCostCents` or 0), "Combined Total" (sum of both); only show "Running Total" and "Combined Total" rows when `runningCosts !== null`; use visually distinct treatment to separate the two cost categories

**Checkpoint**: Budget period view shows running costs when data is present, omits the section when not, and displays separate totals.

---

## Phase 7: User Story 5 — Historical Data Backfill (Priority: P5)

**Goal**: Administrators can import historical billing and usage data from the three API-driven sources (Copilot, Anthropic usage, Anthropic workspace costs) from a chosen start date, with full idempotency on re-run.

**Independent Test**: Trigger a backfill for `github_copilot_billing` with `startDate = "2026-01-01"`. Confirm `copilot_billing_snapshots` and linked `billed_costs` rows appear for January and February. Trigger the same backfill again — confirm zero duplicate rows created. Trigger a regular sync while a backfill is running on the same source — confirm the regular sync is rejected with "sync in progress".

- [ ] T027 [P] [US5] Add backfill mode to `src/lib/sync/sources/github-copilot.ts` — accept `opts.backfillStartDate?: Date`; when present, compute an array of months from `startDate` to the current month; iterate calling the existing billing fetch + `copilotBillingSnapshots` upsert for each month; apply the same idempotent upsert (ON CONFLICT DO UPDATE) so repeated runs never duplicate; accumulate `createdCount`, `updatedCount`, `skippedCount` across all months; call `withSyncLock` with `operationType: 'backfill'` and `backfillStartDate` set; the advisory lock ensures a concurrent regular sync is rejected

- [ ] T028 [P] [US5] Add backfill mode to `src/lib/sync/sources/anthropic-usage.ts` — accept `opts.backfillStartDate?: Date`; iterate in 31-day windows from `startDate` to today (matching the Anthropic Admin API's 31-day per-request limit); for each window, call `fetchAnthropicUsage(windowStart, windowEnd)` and apply the same upsert against `anthropic_usage_metrics`; call `withSyncLock` with `operationType: 'backfill'` and `backfillStartDate`

- [ ] T029 [P] [US5] Add backfill mode to `src/lib/sync/sources/anthropic-workspace.ts` — accept `opts.backfillStartDate?: Date`; iterate month-by-month from `startDate` to current month calling `fetchAndUpsertWorkspaceCosts(month)` for each month (using `cost_report` API with `starting_at`/`ending_at` per month); call `withSyncLock` with `operationType: 'backfill'` and `backfillStartDate`; accumulate `costRowsUpserted` across months in `updatedCount`

- [ ] T030 [US5] Update `src/actions/sync.ts` — in `triggerBackfill()`, add Zod validation: `startDate` must be a valid ISO date string (YYYY-MM-DD), must not be in the future, must not be more than 24 months before today; pass parsed `backfillStartDate` to the source's `run()` call with `operationType: 'backfill'`; return "Backfill not supported for this source" error for `anthropic_team_invoices`, `github_members`, `invoice_period_matching`

**Checkpoint**: All three API-driven sources accept a backfill start date. Historical records appear in the correct budget periods. Re-running the backfill creates no duplicates. A concurrent regular sync is blocked while backfill runs.

---

## Phase 8: User Story 6 — Unified Sync Status Dashboard (Priority: P6)

**Goal**: A single admin page at `/settings/sync` shows all 6 registered sync sources with last run time, outcome, record counts, errors, and manual trigger/backfill controls.

**Independent Test**: Navigate to `/settings/sync`. Confirm all 6 sources appear in a table. Confirm a source that has never synced shows "Never synced" (not blank). Click "Sync Now" on any source — confirm the row updates with a new timestamp and outcome badge after completion.

- [ ] T031 [US6] Create `src/app/(dashboard)/settings/sync/page.tsx` — Server Component with `requireAdmin()` check; call `getSyncStatus()` from `src/actions/sync.ts`; render a shadcn/ui Table with columns: Source Name, Schedule (cron string or "Manual only"), Last Run, Outcome (Badge: success=green, partial=yellow, failed=red, in_progress=blue, never=gray), Created / Updated / Skipped counts, Error message (truncated, shown only when present); for "Never synced" sources render `lastEvent = null` as a "Never synced" cell, not empty; wrap the page in a Suspense boundary with a skeleton fallback

- [ ] T032 [US6] Add `/settings/sync` navigation link to the settings sidebar component (find existing sidebar at `src/app/(dashboard)/settings/layout.tsx` or `src/components/settings-sidebar.tsx`) — link label "Sync Status", Lucide `RefreshCw` icon, points to `/settings/sync`

- [ ] T033 [P] [US6] Add "Sync Now" button to each source row in `src/app/(dashboard)/settings/sync/page.tsx` — extract to a `SyncNowButton` client component in `src/components/sync/sync-now-button.tsx`; on click, call `triggerSync(sourceType)` server action; show loading spinner during execution; on success, call `router.refresh()` to reload the table; show Sonner toast on success ("Sync started") and error ("Sync already in progress" or other error message)

- [ ] T034 [US6] Add "Backfill..." button to API-driven source rows in `src/app/(dashboard)/settings/sync/page.tsx` — extract to a `BackfillDialog` client component in `src/components/sync/backfill-dialog.tsx`; render a shadcn/ui Dialog with a date picker (shadcn/ui Calendar or a date input) for start date; on confirm, call `triggerBackfill(sourceType, startDate)` server action; show loading state, Sonner toast on success/failure, `router.refresh()` on success; show button only for `github_copilot_billing`, `anthropic_api_usage`, `anthropic_workspace_sync`

**Checkpoint**: `/settings/sync` shows all 6 sources. "Sync Now" and "Backfill..." controls work. "Never synced" sources show gracefully.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Remove retired code, add tests, verify constitution gates.

- [ ] T035 Delete retired source files: `src/lib/copilot-sync.ts`, `src/lib/anthropic-sync.ts`, `src/lib/anthropic-workspace-sync.ts`, `src/actions/github-sync.ts`, `src/actions/invoice-sync.ts` — verify no remaining imports reference these files before deletion (run `pnpm typecheck` after each deletion)

- [ ] T036 [P] Unit tests in `tests/unit/sync/framework.test.ts` — test `retryWithBackoff`: verify it retries exactly `maxRetries` times on failure, that delays are between `baseDelay` and `maxDelay + jitter`, that it resolves immediately on first success; test `hashSourceType`: verify determinism (same input → same bigint), verify all 6 source type strings produce distinct bigint values (no hash collisions)

- [ ] T037 [P] Unit tests in `tests/unit/sync/registry.test.ts` — mock DB calls; test `getSyncSources()` returns a result per source type; test `getSyncSource()` returns null for unknown type; test the `SyncSourceWithLastEvent` shape has `lastEvent: null` when no events exist

- [ ] T038 [P] Unit test in `tests/unit/actions/running-costs.test.ts` — mock `anthropic_workspace_costs` rows; test `getRunningCostsForPeriod()` returns correct `runningCostCents` sum for the period date range; test it returns `null` when no rows exist; test `lastUpdatedAt` is the MAX of `updated_at` in the range; test per-workspace breakdown is included only when >1 workspace

- [ ] T039 Integration test in `tests/integration/sync/lock.test.ts` — test `withSyncLock` mutual exclusion: start one sync on `invoice_period_matching`, immediately start a second on the same source; verify the second call throws "Sync already in progress"; verify only one `sync_events` row with `in_progress` exists per source at a time

- [ ] T040 [P] Integration test in `tests/integration/invoices/ingest.test.ts` — POST to `/api/invoices/ingest` with a valid PDF and correct Bearer token; assert 200 and invoice row exists in DB; POST same PDF again; assert 409 with `existingInvoiceId`; POST with no auth header; assert 401

- [ ] T041 [P] Integration test in `tests/integration/sync/copilot-idempotent.test.ts` — seed a `copilot_billing_snapshots` row with `linked_billed_cost_id`; run the copilot source twice; assert `billed_costs` count has not increased; change `total_cost_cents` on the snapshot; run again; assert `billed_costs.amount_cents` is updated, still no new row

- [ ] T042 [P] Integration test in `tests/integration/sync/workspace-costs.test.ts` — seed one `anthropic_workspace_costs` row for a given date; run workspace sync with a mocked `fetchAndUpsertWorkspaceCosts()` returning an updated amount for the same date; assert the row is updated in place, `cost_cents` changed, no duplicate row

- [ ] T043 [P] E2E test in `tests/e2e/sync-dashboard.spec.ts` — navigate to `/settings/sync` as admin; assert a table with 6 rows is visible; assert each row has a source name, a schedule column, and a status cell; assert no row is blank/empty (sources with no events show "Never synced")

- [ ] T044 [P] E2E test in `tests/e2e/budget-period-running-costs.spec.ts` — seed `anthropic_workspace_costs` for the current month; navigate to the budget period detail page for that month; assert a "Running Costs" section is visible and shows a non-zero value; assert it is visually separate from the billed costs section; assert period totals show three values (Billed, Running, Combined)

- [ ] T045 Run full validation — `pnpm lint` (zero warnings), `pnpm typecheck` (zero errors), `pnpm test` (unit tests pass), `pnpm test:integration` (integration tests pass); resolve any failures before marking complete

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)        → no dependencies, start immediately
Phase 2 (Foundational) → depends on Phase 1, BLOCKS all phases 3–9
Phase 3 (US1)          → depends on Phase 2
Phase 4 (US2)          → depends on Phase 3 (T008 must exist)
Phase 5 (US3)          → depends on Phase 2 only (independent of US1)
Phase 6 (US4)          → depends on Phase 2 only (reads existing 018 tables)
Phase 7 (US5)          → depends on Phase 3 (backfill uses source implementations)
Phase 8 (US6)          → depends on Phase 3 (getSyncStatus uses registry)
Phase 9 (Polish)       → depends on Phases 3–8
```

### User Story Dependencies

- **US1 (P1)**: Requires Foundational phase — no other story dependency
- **US2 (P2)**: Requires US1 (copilot source must be extracted first, T008)
- **US3 (P3)**: Requires Foundational phase only — no US1 dependency (uses existing invoice pipeline)
- **US4 (P4)**: Requires Foundational phase only — reads existing `anthropic_workspace_costs` table from 018
- **US5 (P5)**: Requires US1 (backfill mode builds on source implementations)
- **US6 (P6)**: Requires US1 (`getSyncStatus` and `triggerSync` actions from T013)

### Within Each User Story (sequential order per story)

- T003 → T004 → T005 (schema before migration before apply)
- T006, T007 can run in parallel after T003
- T008–T012 can run in parallel (different files) after Phase 2
- T013 depends on T008–T012 (imports all source `run()` functions)
- T014–T016 depend on T013 (import source modules and actions)
- T017, T018 depend on T014–T016 being confirmed working
- T019, T020 depend on T008
- T021 depends on T002; T022 depends on T021
- T023 can start after T005 (DB available); T024 depends on T023; T025, T026 depend on T024
- T027–T029 can run in parallel after T008–T012; T030 depends on T027–T029
- T031 depends on T013 (getSyncStatus); T032 depends on T031; T033, T034 can run in parallel after T031

---

## Parallel Opportunities

### Phase 2 (Foundational)
```
T003 (schema) must complete first, then:
  T004 (migration SQL) ─── sequential after T003
  T006 (framework.ts) ─┬── parallel with T004 (different file)
  T007 (registry.ts)  ─┘── parallel with T004 (different file)
T005 (apply migration) depends on T004
```

### Phase 3 (US1) — maximum parallelism
```
After Phase 2:
  T008 (github-copilot source)   ─┐
  T009 (anthropic-usage source)  ─┤
  T010 (github-members source)   ─┼─ all parallel (different files)
  T011 (invoice-matching source) ─┤
  T012 (anthropic-workspace src) ─┘
After T008–T012:
  T013 (sync.ts actions) ── sequential (depends on all sources)
After T013:
  T014 (copilot route)     ─┐
  T015 (usage route)       ─┼─ parallel (different files)
  T016 (workspace route)   ─┘
After T014–T016: T017 → T018 (sequential)
```

### Phase 7 (US5)
```
T027 (copilot backfill)    ─┐
T028 (usage backfill)      ─┼─ parallel (different source files)
T029 (workspace backfill)  ─┘
T030 (actions update) depends on T027–T029
```

### Phase 9 (Polish)
```
T036 (framework unit tests) ─┐
T037 (registry unit tests)  ─┤
T038 (running cost test)    ─┤
T040 (ingest integration)   ─┼─ all parallel (different test files)
T041 (copilot integration)  ─┤
T042 (workspace integration)─┤
T043 (E2E dashboard)        ─┤
T044 (E2E running costs)    ─┘
T039 (lock integration) ── sequential (modifies shared DB state)
T035 (delete files) ── after typecheck passes
T045 (full validation) ── last task in phase 9
```

---

## Implementation Strategy

### MVP: User Story 1 Only (Framework Foundation)

1. Complete Phase 1: Setup (T001–T002)
2. Complete Phase 2: Foundational (T003–T007) — schema, migration, framework
3. Complete Phase 3: US1 (T008–T018) — all sources migrated, cron routes live
4. **STOP and VALIDATE**: All 6 sources appear in `sync_sources`. Each sync produces a `sync_events` row. No concurrent syncs for same source. `vercel.json` updated.
5. Deploy — existing sync behavior is preserved with consistent locking and observability.

### Incremental Delivery

- **After Phase 3 (US1)**: Framework in place, all existing syncs unified ← ship this
- **After Phase 4 (US2)**: Copilot billing sync creates linked billed costs ← demonstrate automation
- **After Phase 5 (US3)**: Claude Team Plan invoice ingestion endpoint live ← close the automation gap
- **After Phase 6 (US4)**: Budget period view shows authoritative running costs ← financial visibility
- **After Phase 7 (US5)**: Historical backfill available for all API-driven sources ← retroactive data
- **After Phase 8 (US6)**: Unified sync dashboard at `/settings/sync` ← full observability
- **After Phase 9**: Tests, cleanup, validation complete ← production-ready

### Parallel Team Strategy

Once Phase 2 (Foundational) is complete:
- **Developer A**: Phase 3 (US1) — framework migration, source extractions, cron routes
- **Developer B**: Phase 5 (US3) — invoice ingest endpoint (no US1 dependency)
- **Developer C**: Phase 6 (US4) — running costs in budget view (no US1 dependency)
- After Phase 3: Developer A continues to Phase 4 (US2), then Phase 7 (US5), then Phase 8 (US6)

---

## Notes

- `[P]` tasks touch different files — safe to run concurrently with other `[P]` tasks in the same phase
- `[Story]` label maps each task to its user story for traceability against `spec.md`
- The migration (T004–T005) must be applied before any source or framework code is exercised
- All 5 retired source files (T035) must be deleted only after T008–T012 and `pnpm typecheck` pass
- `vercel.json` change (T017) and old route deletion (T018) must be deployed atomically to avoid cron downtime
- Running cost implementation (T023–T026) reads `anthropic_workspace_costs` introduced by 018 — no new sync work required for US4
- Commit after each phase using the commit messages in `plan.md`
