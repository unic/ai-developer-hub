# Tasks: Invoice Automations — Sync Cleanup & Running Cost Visibility

**Input**: Design documents from `/specs/019-invoice-automations/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Not explicitly requested — test tasks omitted.

**Organization**: Tasks are grouped by user story. US1–US3 and US5 are already implemented; tasks here cover the Session 2026-03-24 sync cleanup (US6), running costs display (US4), and the rename migration.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US4, US6)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Database migration for the `anthropic_workspace_sync` → `anthropic_api_costs` rename and shared infrastructure changes.

- [x] T001 Rename `anthropic_workspace_sync` to `anthropic_api_costs` in the `syncSourceTypeEnum` in `src/lib/db/schema.ts` and update all TypeScript type references
- [x] T002 Generate and apply Drizzle migration for the enum rename (`ALTER TYPE sync_source_type RENAME VALUE`) in `src/lib/db/migrations/`; update seeded `sync_sources` row
- [x] T003 [P] Update `SyncSourceType` union and `SOURCE_LABELS` map in `src/lib/sync/framework.ts` to use `anthropic_api_costs`
- [x] T004 [P] Update `BACKFILL_SOURCES` array in `src/components/sync/backfill-dialog.tsx` to use `anthropic_api_costs`
- [x] T005 [P] Update `triggerSync` switch cases in `src/actions/sync.ts` to use `anthropic_api_costs`
- [x] T006 [P] Rename API route directory from `src/app/api/sync/anthropic-workspace/` to `src/app/api/sync/anthropic-api-costs/` and update the route handler imports
- [x] T007 [P] Update `vercel.json` cron path from `/api/sync/anthropic-workspace` to `/api/sync/anthropic-api-costs`
- [x] T008 Update any remaining references to `anthropic_workspace_sync` across the codebase (grep and fix all occurrences in `src/lib/sync/sources/anthropic-workspace.ts`, `src/lib/sync/registry.ts`, `src/app/settings/sync/sync-dashboard.tsx`)

**Checkpoint**: Rename complete — `anthropic_workspace_sync` no longer appears anywhere in the codebase. App builds and runs successfully.

---

## Phase 2: Foundational (Server Actions & API Routes)

**Purpose**: New server actions and API routes needed by UI phases.

- [x] T009 [P] Add `getSyncHistory(options)` server action in `src/actions/sync.ts` — queries `sync_events` filtered by trigger type (`triggeredBy IS NULL` for scheduled, `IS NOT NULL` for manual), with limit and optional source filter per the contract in `contracts/api-contracts.md`
- [x] T010 [P] Create `checkAnthropicStatus()` server action in `src/actions/anthropic-status.ts` — checks `ANTHROPIC_ADMIN_API_KEY` env var, makes lightweight API call to verify connectivity, returns workspace name from `anthropic_workspaces` table per the contract
- [x] T011 [P] Create `GET /api/anthropic/status` route in `src/app/api/anthropic/status/route.ts` — admin-only, calls `checkAnthropicStatus()` and returns JSON response

**Checkpoint**: Server actions and API routes ready for UI consumption.

---

## Phase 3: User Story 4 — Claude API Running Costs in Budget View (Priority: P4)

**Goal**: Display accumulated Claude API costs as "Running Costs" in the budget period detail view, visually distinct from billed costs, with a "last updated" timestamp.

**Independent Test**: Navigate to any budget period overlapping a month with Claude API usage data and confirm a "Running Costs" section appears with the correct aggregated amount from `anthropic_workspace_costs`.

### Implementation for User Story 4

- [x] T012 [US4] Add `getRunningCostsForPeriod(periodId)` helper in `src/lib/budget-utils.ts` — aggregates `SUM(cost_cents)` and `MAX(updated_at)` from `anthropic_workspace_costs` for the period's date range; returns `null` if sum is zero
- [x] T013 [US4] Update the budget period detail server component (find the period detail page in `src/app/budget/`) to call `getRunningCostsForPeriod()` and pass results as props
- [x] T014 [US4] Add "Running Costs" section to the budget period detail UI — visually distinct from billed costs (different badge/label reading "Running Costs"), "last updated" timestamp, and three totals: Billed Total, Running Total, Combined Total

**Checkpoint**: Budget period view shows running costs from `anthropic_workspace_costs`, clearly labeled and separated from billed costs.

---

## Phase 4: User Story 6 — Unified Sync Status Dashboard (Priority: P6) — Part A: Scattered Button Removal

**Goal**: Remove all sync trigger buttons from individual pages so the Sync Status page becomes the sole location for sync operations.

**Independent Test**: Visit `/users`, `/users/[id]`, `/copilot/billing`, `/invoices`, and `/settings/integrations` — no sync trigger button should be present on any of them.

### Implementation for User Story 6 — Part A

- [x] T015 [P] [US6] Delete `src/app/users/sync-all-button.tsx` and remove its import/usage from `src/app/users/page.tsx`
- [x] T016 [P] [US6] Remove sync button (if any) from `src/app/users/[id]/user-detail-client.tsx` — keep "Last synced" display
- [x] T017 [P] [US6] Remove `BillingSyncButton` import/usage and sync history table section from `src/app/copilot/billing/page.tsx`
- [x] T018 [P] [US6] Remove `SyncInvoicesButton` import/usage from `src/app/invoices/page.tsx` (keep other header buttons like "Bulk Upload" and "Upload Invoice")
- [x] T019 [P] [US6] Delete `src/components/copilot/billing-sync-button.tsx` if no longer imported anywhere
- [x] T020 [P] [US6] Delete `src/components/claude-sync-section.tsx` (replaced by Claude Code status card in Phase 5)

**Checkpoint**: No sync trigger buttons remain on any page outside of `/settings/sync`.

---

## Phase 5: User Story 6 — Part B: Integrations Page Cleanup

**Goal**: Scope the Integrations page to connection management only + Claude Code integration status card.

**Independent Test**: Navigate to `/settings/integrations` — should show GitHub connection card (org, token, disconnect) and Claude Code status card. No sync history, no sync triggers, no member sync preview.

### Implementation for User Story 6 — Part B

- [x] T021 [US6] Strip sync-related functionality from `src/app/settings/integrations/github-integration-client.tsx` — remove sync preview tabs (Matched/Unmatched GitHub/Unmatched System), `fetchGitHubSyncPreview()` calls, `confirmGitHubSync()` calls, `CopilotSyncSection` rendering, sync history table. Keep: token validation, org selection, connection management (connect/disconnect/update token)
- [x] T022 [US6] Update `src/app/settings/integrations/page.tsx` — remove `ClaudeSyncSection` import/rendering, remove sync history data fetching, remove `getCopilotSyncStatus()` call. Add `checkAnthropicStatus()` data fetching
- [x] T023 [US6] Create `src/app/settings/integrations/claude-code-status-card.tsx` — read-only card showing: title "Claude Code (Anthropic API)", status badge (Connected green / Not Configured amber), workspace name, last API connectivity check timestamp. No action buttons. Uses shadcn/ui Card, Badge components

**Checkpoint**: Integrations page shows only GitHub connection management and Claude Code read-only status card.

---

## Phase 6: User Story 6 — Part C: Sync Dashboard Enhancements

**Goal**: Enhance the sync status dashboard with split scheduled/manual tables, error popovers, progress toasts, and special handling for GitHub Members and Invoice Period Matching sources.

**Independent Test**: Navigate to `/settings/sync` — verify two tables (Scheduled Jobs, Manual Jobs), clickable error popovers, toast notifications on sync trigger, and spinner during in-progress syncs.

### Implementation for User Story 6 — Part C

- [x] T024 [P] [US6] Create `src/app/settings/sync/error-popover.tsx` — Radix Popover wrapping truncated error text (~50 chars with `truncate` class); PopoverContent shows full error in scrollable container (`max-h-60`). Keyboard accessible. Only renders when `errorMessage` is non-null
- [x] T025 [P] [US6] Create `src/app/settings/sync/scheduled-jobs-table.tsx` — table component for cron-triggered events (where `triggeredBy IS NULL`). Columns: Source (with label from `SOURCE_LABELS`), Schedule, Last Run, Status (badge), Created/Updated/Skipped, Error (using `ErrorPopover`), Actions (SyncNowButton + BackfillDialog)
- [x] T026 [P] [US6] Create `src/app/settings/sync/manual-jobs-table.tsx` — table component for manually-triggered events (where `triggeredBy IS NOT NULL`). Columns: Source, Triggered By (user name), Run Time, Status (badge), Created/Updated/Skipped, Error (using `ErrorPopover`)
- [x] T027 [US6] Rewrite `src/app/settings/sync/sync-dashboard.tsx` — replace single table with two sections: "Scheduled Jobs" heading + `ScheduledJobsTable`, "Manual Jobs" heading + `ManualJobsTable`. Add polling logic: `useEffect` + `setInterval(5000)` that calls `getSyncStatus()` when any source shows `in_progress`. Add toast pattern: `toast.info` on sync start, `toast.success`/`toast.error` on completion with counts summary
- [x] T028 [US6] Update `src/app/settings/sync/page.tsx` to fetch both `getSyncStatus()` (for scheduled table source cards) and `getSyncHistory({ triggerType: 'manual' })` (for manual jobs table) and pass to `SyncDashboard`
- [x] T029 [US6] Add invoice period matching dry-run support to sync dashboard — when source is `invoice_period_matching`, the "Sync Now" button should render as a dropdown (DropdownMenu) with "Sync Now" and "Preview Changes (Dry Run)" options. Dry run calls `syncInvoices({ dryRun: true })` and opens `SyncResultsDialog`. Reuse existing `src/app/invoices/sync-results-dialog.tsx` component

**Checkpoint**: Sync dashboard shows split tables, error popovers work, toast progress notifications fire, and invoice dry-run is accessible.

---

## Phase 7: User Story 6 — Part D: GitHub Member Sync Sheet

**Goal**: Migrate the interactive GitHub member sync workflow from the Integrations page to a full-page Sheet dialog on the Sync Status page.

**Independent Test**: On `/settings/sync`, click "Sync Now" for GitHub Members — a Sheet opens with the full preview → match → resolve → confirm workflow. Sync only executes on confirm.

### Implementation for User Story 6 — Part D

- [x] T030 [US6] Create `src/app/settings/sync/github-member-sync-sheet.tsx` — Radix Sheet (full side panel) containing the interactive preview workflow extracted from `github-integration-client.tsx`. Includes: 3 tabs (Matched / Unmatched GitHub / Unmatched System), manual matching via `UserSearchCombobox`, inline user creation via `InlineUserForm`, conflict detection, resolution progress counters. Calls existing `fetchGitHubSyncPreview()` and `confirmGitHubSync()` server actions. Sheet closes on cancel or successful confirm
- [x] T031 [US6] Update `src/app/settings/sync/sync-dashboard.tsx` (or `scheduled-jobs-table.tsx`) — when source is `github_members`, the "Sync Now" button opens the `GitHubMemberSyncSheet` instead of calling `triggerSync()` directly
- [x] T032 [US6] Verify that `src/components/unmatched-member-card.tsx`, `UserSearchCombobox`, and `InlineUserForm` components are properly importable from their current locations and work within the Sheet context (no circular dependencies)

**Checkpoint**: GitHub member sync interactive workflow is fully functional from the Sync Status page Sheet dialog.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Cleanup, dead code removal, and validation.

- [x] T033 [P] Remove any now-unused imports and dead code left after sync button removals — check `src/app/invoices/sync-invoices-button.tsx` (can be deleted if only used on invoices page), `src/app/invoices/sync-results-dialog.tsx` (keep — reused in T029)
- [x] T034 [P] Verify `SOURCE_LABELS` in the sync dashboard displays "Anthropic API Costs" (not "Anthropic Workspace Sync") for the renamed source
- [x] T035 [P] Verify the budget period view running costs section handles edge cases: zero-value periods (omitted), periods with no `anthropic_workspace_costs` data (no section shown), ended periods (final total)
- [x] T036 Run `pnpm typecheck` to ensure zero TypeScript errors across all modified files
- [x] T037 Run `pnpm lint` to ensure zero ESLint warnings
- [x] T038 Run `pnpm build` to verify production build succeeds
- [ ] T039 Manual smoke test: navigate through all modified pages (`/settings/sync`, `/settings/integrations`, `/copilot/billing`, `/invoices`, `/users`, `/budget/[period]`) and verify expected behavior

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 (enum rename must be in place)
- **Phase 3 (US4 Running Costs)**: Depends on Phase 1 only (no dependency on UI phases)
- **Phase 4 (US6-A Button Removal)**: Depends on Phase 1 only
- **Phase 5 (US6-B Integrations)**: Depends on Phase 2 (needs `checkAnthropicStatus` action) and Phase 4 (sync components removed)
- **Phase 6 (US6-C Dashboard)**: Depends on Phase 2 (needs `getSyncHistory` action) and Phase 4 (buttons removed from other pages)
- **Phase 7 (US6-D Member Sync)**: Depends on Phase 5 (sync code removed from integrations) and Phase 6 (dashboard ready)
- **Phase 8 (Polish)**: Depends on all previous phases

### User Story Dependencies

- **US4 (Running Costs)**: Independent — can proceed after Phase 1
- **US6 (Sync Dashboard)**: Split into Parts A→B→C→D for incremental delivery

### Parallel Opportunities

After Phase 1 completes:
- Phase 3 (US4) and Phase 4 (US6-A) can run **in parallel** — different files, no dependencies
- Within Phase 4, all T015–T020 are [P] — different files, can all run in parallel
- Within Phase 6, T024–T026 are [P] — new component files, can run in parallel

### Within Each Phase

- T001 before T002 (schema change before migration)
- T003–T008 can run in parallel after T001
- T024–T026 before T027 (components before dashboard rewrite)
- T030 before T031 (Sheet component before dashboard integration)

---

## Parallel Example: Phase 4 (Button Removal)

```bash
# All button removal tasks can run simultaneously:
Task T015: "Delete sync-all-button.tsx and remove from users page"
Task T016: "Remove sync button from user-detail-client.tsx"
Task T017: "Remove BillingSyncButton from copilot billing page"
Task T018: "Remove SyncInvoicesButton from invoices page"
Task T019: "Delete billing-sync-button.tsx"
Task T020: "Delete claude-sync-section.tsx"
```

---

## Implementation Strategy

### MVP First (US4 Only)

1. Complete Phase 1: Rename migration
2. Complete Phase 3: Running costs in budget view
3. **STOP and VALIDATE**: Budget periods show running costs correctly
4. Commit and verify

### Incremental Delivery

1. Phase 1 → Rename complete → **Commit**
2. Phase 2 → New server actions ready → **Commit**
3. Phase 3 (US4) → Running costs visible in budget view → **Commit**
4. Phase 4 (US6-A) → Scattered buttons removed → **Commit**
5. Phase 5 (US6-B) → Integrations page cleaned up → **Commit**
6. Phase 6 (US6-C) → Dashboard enhanced → **Commit**
7. Phase 7 (US6-D) → Member sync Sheet working → **Commit**
8. Phase 8 → Polish, typecheck, build → **Final Commit**

Each phase adds value without breaking previous phases. The user requested committing often — commit after each phase checkpoint.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- US1 (Unified Framework), US2 (Copilot Sync), US3 (Team Plan Ingestion), US5 (Backfill) are already implemented — no tasks generated
- US4 and US6 are the active work items for this iteration
- Commit after each phase checkpoint as requested
- The `anthropic_workspace_sync` → `anthropic_api_costs` rename touches many files — complete Phase 1 fully before starting other phases
