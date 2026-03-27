# Tasks: Multiple Claude API Plan Connections

**Input**: Design documents from `/specs/026-multiple-api-plans/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/api-contracts.md, research.md, quickstart.md

**Tests**: Not explicitly requested — test tasks omitted.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Schema changes, new table, migration, and shared type definitions

- [ ] T001 Add `anthropic_plan_status` enum and `anthropic_plan_connections` table to Drizzle schema in `src/lib/db/schema.ts`
- [ ] T002 Add `planConnectionId` column (nullable initially) to `anthropic_usage_metrics`, `anthropic_sync_status`, `anthropic_workspaces`, `anthropic_workspace_costs`, and `sync_events` tables in `src/lib/db/schema.ts`
- [ ] T003 Add plan-connection-related TypeScript types to `src/types/index.ts` (PlanConnection, PlanConnectionStatus, extended CostData with planLabel, extended GlobalCostDashboardData with planLabel/planConnectionId on workspace breakdown)
- [ ] T004 Generate Drizzle migration files with `pnpm db:generate`

**Checkpoint**: Schema definitions complete, migration files generated. Ready for foundational work.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Migration execution, auto-import logic, and refactored API functions that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T005 Write migration SQL to create `anthropic_plan_connections` table, auto-import `ANTHROPIC_ADMIN_API_KEY` env var as first plan connection (encrypt with existing `encryptApiKey()` from `src/lib/crypto.ts`, generate hint with `maskApiKey()`), backfill all existing rows in modified tables with the first plan's ID, then set `planConnectionId` columns to NOT NULL, drop old unique indexes, and create new composite indexes — in `drizzle/` migration file
- [ ] T006 Refactor `fetchOrgApiKeys()` in `src/lib/anthropic-keys.ts` to accept explicit `adminApiKey: string` parameter instead of reading `process.env.ANTHROPIC_ADMIN_API_KEY`
- [ ] T007 [P] Refactor `fetchAnthropicUsage()` in `src/lib/anthropic-sync.ts` to accept explicit `adminApiKey: string` parameter instead of reading env var
- [ ] T008 [P] Refactor `fetchWorkspaces()` and `fetchCostReport()` in `src/lib/sync/sources/anthropic-workspace.ts` to accept explicit `adminApiKey: string` parameter instead of reading env var
- [ ] T009 [P] Refactor `checkAnthropicStatus()` in `src/actions/anthropic-status.ts` to accept optional `adminApiKey?: string` parameter (falls back to env var for backward compat during auto-import)
- [ ] T010 Add `planConnectionId?: number` to `WithSyncLockParams` in `src/lib/sync/framework.ts` — include it in FNV-32 advisory lock hash computation and store in `sync_events` row on insert
- [ ] T011 Add helper function `getActivePlanConnections()` in `src/actions/plan-connections.ts` that queries all active plan connections and decrypts their admin API keys (used by sync orchestration)
- [ ] T012 Apply migration with `pnpm db:migrate` and verify auto-import of env var key

**Checkpoint**: Foundation ready — all API functions accept plan-specific keys, sync framework supports plan IDs, migration applied. User story implementation can now begin.

---

## Phase 3: User Story 1 — Admin Connects Additional API Plans (Priority: P1) 🎯 MVP

**Goal**: Admins can add, view, edit labels, and disconnect multiple Claude API plan connections via the integrations settings page.

**Independent Test**: Navigate to `/settings/integrations`, add two plan connections with valid admin API keys and labels, verify both appear with correct status. Edit a label, disconnect one, verify soft delete.

### Implementation for User Story 1

- [ ] T013 [US1] Create Zod validation schemas for plan connection inputs (label: 1–200 chars trimmed, adminApiKey: non-empty) in `src/lib/validators.ts`
- [ ] T014 [US1] Implement `getPlanConnections()` server action in `src/actions/plan-connections.ts` — returns all connections with id, label, adminApiKeyHint, status, createdAt, disconnectedAt (admin-only auth check)
- [ ] T015 [P] [US1] Implement `addPlanConnection(data)` server action in `src/actions/plan-connections.ts` — validates input, checks active count < 10, checks hint uniqueness among active connections, verifies API key via `checkAnthropicStatus(adminApiKey)`, encrypts key, inserts row, returns new connection
- [ ] T016 [P] [US1] Implement `updatePlanConnectionLabel(id, label)` server action in `src/actions/plan-connections.ts` — validates label, updates row
- [ ] T017 [P] [US1] Implement `disconnectPlanConnection(id)` server action in `src/actions/plan-connections.ts` — validates connection exists and is active, prevents disconnecting if it's the only active connection, sets status to 'disconnected' and disconnectedAt timestamp
- [ ] T018 [US1] Create `PlanConnectionsCard` client component in `src/components/settings/plan-connections-card.tsx` — displays list of plan connections with label, masked key hint, status badge (Connected/Disconnected), created date; includes "Add Plan" button opening a dialog with label + API key inputs; edit label inline; disconnect button with confirmation
- [ ] T019 [US1] Integrate `PlanConnectionsCard` into `/settings/integrations` page in `src/app/settings/integrations/page.tsx` — add below or replace existing `ClaudeCodeStatusCard`, pass plan connections data from server action
- [ ] T020 [US1] Update `ClaudeCodeStatusCard` in `src/app/settings/integrations/claude-code-status-card.tsx` to show connection status based on active plan connections count rather than env var check — or replace with `PlanConnectionsCard`

**Checkpoint**: Admin can fully manage plan connections via UI. MVP deliverable.

---

## Phase 4: User Story 2 — User API Keys Resolve Across Multiple Plans (Priority: P1)

**Goal**: During sync, user API keys are resolved against all connected plans. Usage data is fetched per-plan and stored with plan association. Profile page displays usage transparently.

**Independent Test**: Assign API keys from two different plans to two users, run sync, verify each user's profile page shows correct usage data sourced from their respective plan.

### Implementation for User Story 2

- [ ] T021 [US2] Refactor `resolveAllMappings()` in `src/lib/anthropic-sync.ts` to accept `adminApiKey: string` and `planConnectionId: number` — call `fetchOrgApiKeys(adminApiKey)` for that specific plan, resolve user keys against that plan's org keys, cache `planConnectionId` in `anthropicSyncStatus.resolvedApiKeyId` alongside the key ID
- [ ] T022 [US2] Refactor `runAnthropicSyncCore()` in `src/lib/anthropic-sync.ts` to iterate all active plan connections — for each plan: decrypt admin key, call `resolveAllMappings(adminApiKey, planConnectionId)`, fetch usage via `fetchAnthropicUsage(adminApiKey, ...)`, store results with `planConnectionId` in `anthropicUsageMetrics`
- [ ] T023 [US2] Update `batchUpsertUsageRows()` in `src/lib/anthropic-sync.ts` to include `planConnectionId` in upsert composite key `(userId, date, model, planConnectionId)` and in the inserted/updated data
- [ ] T024 [US2] Update `syncSingleUser()` in `src/lib/anthropic-sync.ts` to look up the user's resolved plan connection and use that plan's admin key for the sync
- [ ] T025 [US2] Update the `run()` function in `src/lib/sync/sources/anthropic-usage.ts` to accept optional `planConnectionId` in `RunOptions` — when omitted, iterate all plans; when specified, sync that plan only. Pass `planConnectionId` to `withSyncLock()` for independent per-plan advisory locks
- [ ] T026 [US2] Update `fetchUserCostDataInternal()` in `src/lib/profile-data.ts` to query `anthropicUsageMetrics` filtering by active plan connections (exclude disconnected plans' data from user view), aggregating across all plans transparently
- [ ] T027 [US2] Verify profile page (`src/app/profile/page.tsx`) displays usage correctly without changes — the transparent aggregation in T026 should make this work without UI modifications

**Checkpoint**: Users see their correct usage data regardless of which plan their key belongs to. Sync resolves across all plans.

---

## Phase 5: User Story 3 — Aggregated Usage on Admin User Page (Priority: P2)

**Goal**: Admin user detail page shows which plan each user's usage comes from, displaying the plan label alongside cost data.

**Independent Test**: View a user's detail page after syncing with multiple plans; verify plan label appears next to usage breakdown.

### Implementation for User Story 3

- [ ] T028 [US3] Extend `fetchUserCostDataInternal()` in `src/lib/profile-data.ts` to join `anthropic_plan_connections` table and return `planLabel` when caller is admin — add to return type
- [ ] T029 [US3] Update `getUserCostData()` server action in `src/actions/anthropic-usage.ts` to pass caller role context so `fetchUserCostDataInternal()` knows whether to include `planLabel`
- [ ] T030 [US3] Update `CostTrackingSection` component in `src/components/profile/cost-tracking-section.tsx` to accept and display optional `planLabel` prop — show as a subtle badge or label next to the monthly total when present
- [ ] T031 [US3] Update `AdminCostSection` in `src/components/profile/admin-cost-section.tsx` to pass `planLabel` from cost data to `CostTrackingSection`
- [ ] T032 [US3] Update user detail page data fetching in `src/app/users/[id]/page.tsx` to pass plan label through to the cost section component

**Checkpoint**: Admins see plan attribution on user detail pages. No change to user self-view.

---

## Phase 6: User Story 4 — Multi-Plan Workspace Cost Aggregation (Priority: P2)

**Goal**: Global Claude metrics dashboard aggregates workspace costs across all connected plans with plan filter and disambiguation.

**Independent Test**: Connect two plans, sync workspace data, verify dashboard shows costs from both plans with per-plan filtering.

### Implementation for User Story 4

- [ ] T033 [US4] Update the `run()` function in `src/lib/sync/sources/anthropic-workspace.ts` to accept optional `planConnectionId` in `RunOptions` — when omitted iterate all plans; for each plan: decrypt admin key, call `fetchWorkspaces(adminApiKey)` and `fetchCostReport(adminApiKey, ...)`, store results with `planConnectionId` in `anthropicWorkspaces` and `anthropicWorkspaceCosts`
- [ ] T034 [US4] Update workspace upsert logic in `src/lib/sync/sources/anthropic-workspace.ts` to use composite unique keys including `planConnectionId` — update the partial unique index conflict clauses for both named and default workspaces
- [ ] T035 [US4] Extend `getGlobalCostDashboard()` server action in `src/actions/anthropic-usage.ts` to accept optional `planConnectionId` filter — when provided filter by plan, when omitted aggregate across all active plans. Add `planLabel` and `planConnectionId` to each workspace breakdown entry
- [ ] T036 [US4] Extend `getWorkspaceList()` server action to include `planLabel` for each workspace by joining `anthropic_plan_connections`
- [ ] T037 [US4] Add plan filter dropdown to `GlobalMetricsClient` in `src/components/claude/global-metrics-client.tsx` — populate from active plan connections, add "All Plans" default option, re-fetch dashboard data when plan filter changes
- [ ] T038 [US4] Update workspace breakdown display in `GlobalMetricsClient` to show plan label alongside workspace name for disambiguation when multiple plans are active

**Checkpoint**: Dashboard shows aggregated costs with plan filtering. Workspace names disambiguated by plan.

---

## Phase 7: User Story 5 — Sync Iterates All Active Plans (Priority: P3)

**Goal**: Sync framework gracefully iterates all plans with per-plan error isolation and sync event tracking.

**Independent Test**: Connect two plans (one valid, one with bad key), trigger sync, verify healthy plan syncs and failed plan's error is captured in sync events.

### Implementation for User Story 5

- [ ] T039 [US5] Update the Anthropic usage cron route in `src/app/api/sync/anthropic-usage/route.ts` to support optional `planConnectionId` query parameter — pass to `run()` for plan-specific manual triggers
- [ ] T040 [P] [US5] Update the Anthropic workspace costs cron route in `src/app/api/sync/anthropic-api-costs/route.ts` to support optional `planConnectionId` query parameter
- [ ] T041 [US5] Add error isolation in `runAnthropicSyncCore()` in `src/lib/anthropic-sync.ts` — wrap each plan's sync iteration in try/catch so one plan's failure doesn't abort the remaining plans; collect per-plan errors in sync summary
- [ ] T042 [US5] Update `SyncSummary` type in `src/lib/anthropic-sync.ts` to include per-plan results (plan label, synced users, errors) alongside the existing aggregate totals
- [ ] T043 [US5] Add manual per-plan sync trigger to `PlanConnectionsCard` in `src/components/settings/plan-connections-card.tsx` — small sync icon button per plan that calls the sync endpoint with `planConnectionId`

**Checkpoint**: Sync is fully plan-aware with error isolation. All user stories functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Cleanup, edge cases, and validation

- [ ] T044 [P] Add edge case handling for duplicate API key hint detection across plans in `addPlanConnection()` in `src/actions/plan-connections.ts` — warn if a key hint matches across different plans (potential cross-plan key collision)
- [ ] T045 [P] Update `syncAnthropicUsage()` and `syncAllAnthropicUsage()` manual trigger actions in `src/actions/anthropic-usage.ts` to work with the multi-plan sync orchestration
- [ ] T046 Run `pnpm typecheck` and fix any TypeScript errors across all modified files
- [ ] T047 Run `pnpm lint` and fix any ESLint warnings across all modified files
- [ ] T048 Run quickstart.md validation — verify migration, plan connections UI, sync, profile page, and dashboard all work end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 — no dependencies on other stories
- **US2 (Phase 4)**: Depends on Phase 2 — benefits from US1 for plan data but can use DB seeding
- **US3 (Phase 5)**: Depends on Phase 2 + US2 (needs usage data with plan associations)
- **US4 (Phase 6)**: Depends on Phase 2 — independent of US1/US2/US3
- **US5 (Phase 7)**: Depends on Phase 2 + US2 (needs multi-plan sync core from T022)
- **Polish (Phase 8)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: Independent — only needs foundational phase
- **US2 (P1)**: Independent — only needs foundational phase (core sync refactoring)
- **US3 (P2)**: Depends on US2 (needs planConnectionId in usage metrics)
- **US4 (P2)**: Independent — only needs foundational phase (workspace sync refactoring)
- **US5 (P3)**: Depends on US2 (builds on multi-plan sync iteration from T022)

### Within Each User Story

- Server actions before UI components
- Data layer changes before display layer
- Core logic before integration points

### Parallel Opportunities

- T007, T008, T009 can run in parallel (independent API function refactors)
- T015, T016, T017 can run in parallel (independent server actions)
- US1 and US2 can start in parallel after Phase 2
- US4 can run in parallel with US1/US2/US3
- T039, T040 can run in parallel (independent route updates)
- T044, T045 can run in parallel (independent polish tasks)

---

## Parallel Example: Phase 2 (Foundational)

```bash
# After T005 (migration) and T006 (fetchOrgApiKeys refactor):
# Launch parallel API function refactors:
Task T007: "Refactor fetchAnthropicUsage() in src/lib/anthropic-sync.ts"
Task T008: "Refactor fetchWorkspaces/fetchCostReport in src/lib/sync/sources/anthropic-workspace.ts"
Task T009: "Refactor checkAnthropicStatus() in src/actions/anthropic-status.ts"
```

## Parallel Example: User Story 1

```bash
# After T013 (validators) and T014 (getPlanConnections):
# Launch parallel CRUD server actions:
Task T015: "Implement addPlanConnection() in src/actions/plan-connections.ts"
Task T016: "Implement updatePlanConnectionLabel() in src/actions/plan-connections.ts"
Task T017: "Implement disconnectPlanConnection() in src/actions/plan-connections.ts"
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2)

1. Complete Phase 1: Setup (schema + types)
2. Complete Phase 2: Foundational (migration + API refactors)
3. Complete Phase 3: US1 — Admin can manage plan connections
4. Complete Phase 4: US2 — Sync resolves across plans, profiles work
5. **STOP and VALIDATE**: Both P1 stories independently testable
6. Deploy/demo — core multi-plan functionality is live

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. US1 → Plan management UI live (MVP increment 1)
3. US2 → Multi-plan sync working, profiles correct (MVP increment 2)
4. US3 → Admin sees plan labels on user pages
5. US4 → Dashboard aggregates across plans
6. US5 → Sync error isolation + per-plan triggers
7. Polish → Edge cases, type/lint checks, e2e validation

---

## Notes

- Commit after each task or logical group (user requested frequent commits)
- Use subagents for parallel tasks where marked [P]
- No new dependencies needed — all built on existing patterns
- Budget views (`annualBudgets`, `budgetPeriods`, `billedCosts`) are NOT touched — FR-011/SC-006
- Max 10 active plan connections enforced at application level
- The `ANTHROPIC_ADMIN_API_KEY` env var is auto-imported once and can be removed afterward
