# Tasks: GitHub Copilot Integration

**Input**: Design documents from `/specs/013-github-copilot-integration/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/server-actions.md, quickstart.md

**Tests**: Not explicitly requested — test tasks omitted. Add unit/e2e tests as needed during implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup

**Purpose**: Schema changes, new types, validation schemas, and API wrapper — shared infrastructure for all user stories.

- [x] T001 Add `copilotSyncTypeEnum`, `copilotUsageMetrics` table, and `copilotBillingSnapshots` table to Drizzle schema; add `copilotSyncEnabled` and `copilotSyncSchedule` columns to `githubConnections`; add `source` column to `licenseAssignments`; add `syncType`, `seatsProcessed`, `metricsProcessed`, `billingProcessed` columns to `githubSyncEvents`; define relations in `src/lib/db/schema.ts`
- [x] T002 Generate and apply database migration for all schema changes via `pnpm db:generate && pnpm db:push` in `src/lib/db/migrations/`
- [x] T003 [P] Add Copilot-related TypeScript types to `src/types/index.ts`: select/insert types for new tables (`CopilotUsageMetric`, `CopilotBillingSnapshot`), `CopilotSyncStatus` type, `CopilotOverviewData`, `CopilotSeatData`, `CopilotBillingData`, `CopilotAnalyticsData` response types per contracts/server-actions.md
- [x] T004 [P] Add Copilot validation schemas to `src/lib/validators.ts`: `copilotDateRangeSchema`, `copilotSeatFilterSchema`, `copilotSeatDetailSchema` per contracts/server-actions.md input types
- [x] T005 [P] Create GitHub Copilot API wrapper in `src/lib/copilot-api.ts` with functions: `fetchCopilotBilling(token, org)`, `fetchCopilotSeats(token, org)`, `fetchCopilotMetrics(token, org, since?, until?)` — reuse `githubFetch` pattern from `src/lib/github.ts` for auth headers, rate limit tracking, pagination, and error handling

**Checkpoint**: Schema, types, validators, and API wrapper ready. All subsequent phases can build on this foundation.

---

## Phase 2: Foundational (Sync Pipeline & Connection Management)

**Purpose**: Core sync pipeline and connection actions that MUST be complete before dashboards or UI.

**CRITICAL**: No user story UI work can begin until the sync pipeline (T006-T009) is functional.

- [x] T006 Implement `syncBillingData` function in `src/lib/copilot-sync.ts`: fetch org Copilot billing, upsert "GitHub Copilot" AI Tool + access tiers (Business/Enterprise) via existing `aiTools`/`accessTiers` tables, update `maxLicenses`, upsert `copilotBillingSnapshots` record, create/update `billedCosts` entry if matching budget period exists (skip if no budget), tag with vendor reference for dedup
- [x] T007 Implement `syncSeatAssignments` function in `src/lib/copilot-sync.ts`: fetch paginated seats, match to users via `githubProfiles.githubId`, upsert `licenseAssignments` with `source: "copilot-sync"`, revoke assignments for removed seats (set inactive with `revokedAt`), handle tier upgrades/downgrades following existing pattern in `src/actions/assignments.ts`
- [x] T008 Implement `syncUsageMetrics` function in `src/lib/copilot-sync.ts`: determine date range (last synced + 1 to yesterday), fetch metrics, flatten nested editor→model→language structure into `copilotUsageMetrics` rows with JSONB breakdowns, upsert by (connectionId, date)
- [x] T009 Implement `runCopilotSync` orchestrator in `src/lib/copilot-sync.ts`: create sync event (`syncType: "copilot"`, `status: "in_progress"`), run billing→seats→metrics sequentially, update sync event with counts and final status (`completed`/`partial`/`failed`), handle rate limits and partial failures, update `githubConnections.lastSyncAt`
- [x] T010 [P] Implement `enableCopilotSync`, `disableCopilotSync`, `triggerCopilotSync`, `getCopilotSyncStatus` server actions in `src/actions/copilot.ts` per contracts/server-actions.md — include `requireAdmin()` guard, mutual exclusion check (no in-progress sync), scope validation via `copilot-api.ts`, history recording via `src/actions/history.ts`
- [x] T011 [P] Create cron sync API route in `src/app/api/copilot/sync/route.ts`: POST handler protected by `CRON_SECRET` header, fetches active connection with `copilotSyncEnabled`, calls `runCopilotSync`, returns sync event ID

**Checkpoint**: Sync pipeline fully functional. Enable/disable/trigger sync actions work. Data flows into all existing models (AI Tool, assignments, billed costs) and new Copilot tables.

---

## Phase 3: User Story 1 — Enable Copilot Data Sync on Existing GitHub Connection (Priority: P1)

**Goal**: Admin can enable Copilot syncing from the integrations settings page, triggering initial data import into both existing models and Copilot-specific tables.

**Independent Test**: Enable Copilot sync → verify "GitHub Copilot" tool appears in `/tools`, seat assignments appear in `/assignments`, billing entries appear in budget, usage metrics stored in DB.

### Implementation for User Story 1

- [x] T012 [US1] Create Copilot sync settings section component in `src/components/copilot/copilot-sync-section.tsx`: displays scope validation status, enable/disable toggle, sync status (last sync time, result, data range, record counts), "Sync Now" button with disabled state during active sync, sync history list — calls `enableCopilotSync`, `disableCopilotSync`, `triggerCopilotSync`, `getCopilotSyncStatus` actions
- [x] T013 [US1] Integrate Copilot sync section into existing integrations page by modifying `src/app/settings/integrations/github-integration-client.tsx`: add `CopilotSyncSection` below the existing GitHub connection section, conditionally rendered when a GitHub connection is active
- [x] T014 [US1] Update existing assignments UI to handle `source: "copilot-sync"` records: add read-only badge "Managed by sync" and disable edit actions for sync-managed assignments in `src/app/assignments/assignments-client.tsx`
- [x] T015 [US1] Add "Copilot" navigation item to sidebar in `src/components/app-sidebar.tsx`: admin-only, with Copilot icon from Lucide React, positioned after Reports in the nav items array

**Checkpoint**: User Story 1 fully functional — admin can enable/disable Copilot sync, data flows into existing models, sync status visible on settings page, Copilot nav item appears.

---

## Phase 4: User Story 2 — Organization-Level Copilot Dashboard (Priority: P2)

**Goal**: Admin sees an overview dashboard at `/copilot` with Copilot-specific KPIs (seats, acceptance rate, suggestions) and trend charts.

**Independent Test**: Navigate to `/copilot` → verify summary cards show correct metrics, trend chart renders with synced data, date range selector filters data correctly.

### Implementation for User Story 2

- [x] T016 [US2] Implement `getCopilotOverview` server action in `src/actions/copilot-data.ts` per contracts: query `copilotUsageMetrics` for date range, aggregate totals (suggestions, acceptances, lines, active users), compute acceptance rate, query `copilotBillingSnapshots` for seat counts, build trend array from daily metrics
- [x] T017 [P] [US2] Create tab bar component in `src/app/copilot/copilot-tab-bar.tsx` matching existing Reports tab bar pattern (`src/app/reports/reports-tab-bar.tsx`): tabs for Overview, Seats, Billing, Analytics with URL-based active state via `router.replace()`
- [x] T018 [P] [US2] Create Copilot layout in `src/app/copilot/layout.tsx`: admin-only auth guard, shared tab bar via `CopilotTabBar`, standard sidebar layout
- [x] T019 [P] [US2] Create overview KPI cards component in `src/components/copilot/overview-cards.tsx`: total seats, active seats, acceptance rate, total suggestions, total acceptances — follow existing dashboard card pattern from `src/app/page.tsx`
- [x] T020 [P] [US2] Create usage trend chart component in `src/components/copilot/usage-trend-chart.tsx`: line chart showing daily suggestions, acceptances, and active users over time — use `ChartContainer` + `LineChart` per existing `src/components/reports/trends-chart.tsx` pattern
- [x] T021 [US2] Create Copilot overview page in `src/app/copilot/page.tsx`: fetch data via `getCopilotOverview`, render date range picker, `OverviewCards`, `UsageTrendChart`, navigation links to Reports and Budget pages for cost info, empty state when no data synced

**Checkpoint**: Overview dashboard functional with KPIs and trend chart. Date range selection works including historical data beyond 28 days.

---

## Phase 5: User Story 3 — Seat Allocation and User Details (Priority: P3)

**Goal**: Admin sees a searchable/sortable table of all Copilot seat holders at `/copilot/seats` with detail pages showing seat history.

**Independent Test**: Navigate to `/copilot/seats` → verify table shows all seats, search/filter/sort work, clicking a user shows seat detail page with activity timeline.

### Implementation for User Story 3

- [x] T022 [US3] Implement `getCopilotSeats` and `getCopilotSeatDetail` server actions in `src/actions/copilot-data.ts` per contracts: query seat data from `licenseAssignments` (source: copilot-sync) joined with `githubProfiles` and `users`, support search/filter/sort/pagination; detail action fetches seat history from sync events
- [x] T023 [P] [US3] Create seats data table component in `src/components/copilot/seats-table.tsx`: columns for avatar, name, GitHub username, assigned date, last activity, days since active, plan type, status, matched/unmatched indicator — reuse `DataTable` from `src/components/data-table.tsx` with faceted filters for status
- [x] T024 [US3] Create seats page in `src/app/copilot/seats/page.tsx`: fetch data via `getCopilotSeats`, render `SeatsTable` with search bar and status filter, show unmatched users with prompt to import via existing user import flow (`/users/import`), empty state when no seats
- [x] T025 [US3] Create seat detail page in `src/app/copilot/seats/[userId]/page.tsx`: fetch via `getCopilotSeatDetail`, show seat metadata (assignment date, plan type, status, last activity, editor), activity timeline visualization, link to general user profile (`/users/[id]`), back link to Seats tab

**Checkpoint**: Seat allocation table and detail pages functional. Admins can identify underutilized seats within 30 seconds (SC-007).

---

## Phase 6: User Story 4 — Cost and Billing Dashboard (Priority: P4)

**Goal**: Admin sees Copilot-specific cost analysis at `/copilot/billing` with cost trends, cost-per-user, and ROI metrics.

**Independent Test**: Navigate to `/copilot/billing` → verify current month cost, cumulative cost, cost-per-active-user render correctly, trend chart shows monthly costs.

### Implementation for User Story 4

- [x] T026 [US4] Implement `getCopilotBilling` server action in `src/actions/copilot-data.ts` per contracts: query `copilotBillingSnapshots` for date range, compute current month metrics, cumulative cost, cost-per-active-user, build monthly trends array
- [x] T027 [P] [US4] Create billing trend chart component in `src/components/copilot/billing-trend-chart.tsx`: bar or line chart showing monthly cost over time — use `ChartContainer` + `BarChart` pattern, format values as currency (cents → dollars)
- [x] T028 [P] [US4] Create cost vs. utilization chart component in `src/components/copilot/cost-utilization-chart.tsx`: dual-axis chart comparing cost per seat against acceptance rate or active days per month, highlighting ROI trends
- [x] T029 [US4] Create billing page in `src/app/copilot/billing/page.tsx`: fetch via `getCopilotBilling`, render KPI cards (current month cost, cumulative cost, cost-per-active-user, plan type), `BillingTrendChart`, `CostUtilizationChart`, date range picker, empty state

**Checkpoint**: Billing dashboard functional. Cost-per-active-user and ROI metrics displayed (SC-008).

---

## Phase 7: User Story 5 — Usage Patterns and Utilization Analytics (Priority: P5)

**Goal**: Admin sees detailed analytics at `/copilot/analytics` with breakdowns by language, editor, and user activity distribution.

**Independent Test**: Navigate to `/copilot/analytics` → verify language breakdown chart, editor breakdown chart, and activity distribution render correctly with synced data.

### Implementation for User Story 5

- [x] T030 [US5] Implement `getCopilotAnalytics` server action in `src/actions/copilot-data.ts` per contracts: aggregate JSONB `languageBreakdown` and `editorBreakdown` fields across date range from `copilotUsageMetrics`, compute activity distribution from seat last-activity data, build utilization trend from daily active users vs. total seats
- [x] T031 [P] [US5] Create language breakdown chart component in `src/components/copilot/language-chart.tsx`: horizontal bar chart showing top languages by suggestions/acceptances with acceptance rate — use `ChartContainer` + `BarChart` pattern
- [x] T032 [P] [US5] Create editor breakdown chart component in `src/components/copilot/editor-chart.tsx`: bar or pie chart showing editor distribution by engaged users and suggestions
- [x] T033 [P] [US5] Create activity distribution component in `src/components/copilot/activity-distribution.tsx`: visualization showing user segments (power users, regular, occasional, inactive) as a donut chart or segmented bar
- [x] T034 [US5] Create analytics page in `src/app/copilot/analytics/page.tsx`: fetch via `getCopilotAnalytics`, render date range picker, `LanguageChart`, `EditorChart`, `ActivityDistribution`, utilization trend line chart, empty state

**Checkpoint**: Analytics dashboard functional. Language/editor breakdowns and activity distribution visible (SC-010).

---

## Phase 8: User Story 6 — Historical Data Retention Beyond API Limits (Priority: P6)

**Goal**: System retains all synced data permanently and displays data retention info. Date ranges on all dashboards extend beyond 28 days.

**Independent Test**: Verify data retention summary on settings page shows correct date ranges. Verify dashboards accept date ranges exceeding 28 days and display stored historical data.

### Implementation for User Story 6

- [x] T035 [US6] Add data retention display to `src/components/copilot/copilot-sync-section.tsx`: query earliest/latest metric dates and record counts via `getCopilotSyncStatus`, render retention summary card showing available date range and total records per category
- [x] T036 [US6] Implement billing backfill logic in `src/lib/copilot-sync.ts`: add `backfillBilledCosts(connectionId)` function that finds `copilotBillingSnapshots` with null `linkedBilledCostId` where a matching `budgetPeriod` now exists, creates `billedCosts` entries and updates the link; call this during each sync and expose as action for manual trigger
- [x] T037 [US6] Verify all Copilot dashboard date range pickers (in pages created in T021, T024, T029, T034) allow selection of ranges exceeding 28 days back to the earliest stored record; ensure query actions in `src/actions/copilot-data.ts` have no artificial date range caps

**Checkpoint**: Historical data fully retained. Dashboards display data beyond 28-day API limit. Billing backfill works when budgets are created after sync.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories.

- [x] T038 Add loading skeletons for all Copilot pages in `src/app/copilot/loading.tsx`, `src/app/copilot/seats/loading.tsx`, `src/app/copilot/billing/loading.tsx`, `src/app/copilot/analytics/loading.tsx`
- [x] T039 [P] Add error boundaries and empty states across all Copilot pages: "Copilot syncing not enabled" state, "No data yet" state, "Sync in progress" state with appropriate messaging and CTAs
- [x] T040 [P] Ensure all chart components include `accessibilityLayer` prop and ARIA labels on interactive elements for WCAG 2.2 AA compliance
- [x] T041 Verify existing features are unmodified: confirm `/assignments`, `/tools`, `/budget`, `/reports` pages automatically display Copilot data via shared models without any code changes beyond T014 (source badge) and T015 (sidebar nav) — validate SC-011
- [x] T042 Run `pnpm lint && pnpm typecheck && pnpm build` to ensure zero ESLint warnings, zero TypeScript errors, and successful production build

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (schema + API wrapper must exist)
- **User Story 1 (Phase 3)**: Depends on Phase 2 (sync pipeline must work)
- **User Stories 2-5 (Phases 4-7)**: Depend on Phase 2 (need sync data) + Phase 3 T015 (sidebar nav). Can proceed in parallel with each other.
- **User Story 6 (Phase 8)**: Depends on Phases 4-7 (validates date range on all dashboards)
- **Polish (Phase 9)**: Depends on all user story phases

### User Story Dependencies

- **US1 (P1)**: Depends on Foundational only. Must complete first — provides nav item and settings UI.
- **US2 (P2)**: Depends on Foundational + T015 (sidebar nav from US1). Can start once sync works.
- **US3 (P3)**: Depends on Foundational + T015. Independent of US2.
- **US4 (P4)**: Depends on Foundational + T015. Independent of US2/US3.
- **US5 (P5)**: Depends on Foundational + T015. Independent of US2/US3/US4.
- **US6 (P6)**: Depends on US2-US5 (validates date ranges across all dashboards).

### Within Each User Story

- Server actions before UI components
- Shared components before page compositions
- Data-fetching pages integrate actions + components

### Parallel Opportunities

- T003, T004, T005 can all run in parallel (different files)
- T010, T011 can run in parallel with each other (after T009)
- T017, T018, T019, T020 can all run in parallel (different files)
- T023 can run in parallel with T022 (component vs. action)
- T027, T028 can run in parallel (different chart components)
- T031, T032, T033 can run in parallel (different chart components)
- T038, T039, T040 can run in parallel (cross-cutting polish)
- US2, US3, US4, US5 can all proceed in parallel once Phase 2 + T015 complete

---

## Parallel Example: Phase 4 (User Story 2)

```bash
# After T016 (server action) completes, launch all components in parallel:
Task T017: "Create tab bar component in src/app/copilot/copilot-tab-bar.tsx"
Task T018: "Create Copilot layout in src/app/copilot/layout.tsx"
Task T019: "Create overview KPI cards in src/components/copilot/overview-cards.tsx"
Task T020: "Create usage trend chart in src/components/copilot/usage-trend-chart.tsx"

# Then compose them in the page:
Task T021: "Create overview page in src/app/copilot/page.tsx"
```

## Parallel Example: Phase 7 (User Story 5)

```bash
# After T030 (server action) completes, launch all chart components in parallel:
Task T031: "Create language chart in src/components/copilot/language-chart.tsx"
Task T032: "Create editor chart in src/components/copilot/editor-chart.tsx"
Task T033: "Create activity distribution in src/components/copilot/activity-distribution.tsx"

# Then compose them in the page:
Task T034: "Create analytics page in src/app/copilot/analytics/page.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T005)
2. Complete Phase 2: Foundational sync pipeline (T006-T011)
3. Complete Phase 3: User Story 1 settings UI (T012-T015)
4. **STOP and VALIDATE**: Enable Copilot sync → verify data in existing `/tools`, `/assignments`, `/budget` pages
5. Deploy/demo — Copilot data already visible across existing dashboards via shared models

### Incremental Delivery

1. Setup + Foundational + US1 → Data flowing, sync working (MVP)
2. Add US2 (Overview Dashboard) → Visual KPIs and trends
3. Add US3 (Seats Table) → Seat optimization capability
4. Add US4 (Billing Dashboard) → Cost analysis and ROI
5. Add US5 (Analytics) → Language/editor/utilization insights
6. Add US6 (Retention) → Backfill + long-term data validation
7. Polish → Loading states, a11y, build verification

### Parallel Team Strategy

With multiple developers after Phase 2:

- Developer A: US1 (settings UI) → US6 (retention/backfill)
- Developer B: US2 (overview dashboard) → US4 (billing dashboard)
- Developer C: US3 (seats table + detail) → US5 (analytics)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable after Phase 2
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Monetary values always in cents (integers) — format to dollars only in UI
- All charts must use `ChartContainer` + `ChartConfig` per existing pattern
- All data tables must use `DataTable` component per existing pattern
- Server Actions must return `ActionResult<T>` and use `requireAdmin()` guard
