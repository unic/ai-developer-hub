# Research: Running API Costs in Budget View

**Branch**: `025-running-api-costs` | **Date**: 2026-03-27

## Research Questions & Findings

### RQ-1: Does the budget overview page show running costs?

**Decision**: The budget overview page (`/budget/page.tsx`) does NOT currently show running API costs. Only the budget detail page (`/budget/[id]/page.tsx`) calls `getRunningCostsForPeriod()` — and it already does so for ALL periods in parallel via `Promise.all()`.

**Implication**: US-3 (budget overview with running costs) requires adding running cost fetching to the overview page. The detail page already works for all periods — no changes needed there.

**Alternatives considered**: None — the overview page simply doesn't have this data yet.

### RQ-2: Does the existing backfill already populate historical data for the budget view?

**Decision**: Yes. The backfill for `anthropic_api_costs` iterates month-by-month from the start date to today, calling `fetchAndUpsertWorkspaceCosts()` for each month. Data is upserted into `anthropic_workspace_costs` with ON CONFLICT DO UPDATE semantics. Since `getRunningCostsForPeriod()` queries this table by date range, backfilled data is immediately available in the budget detail view.

**Implication**: The core backfill-to-budget pipeline already works. The primary work is fixing error handling gaps and adding the budget overview integration.

### RQ-3: What error handling gaps exist in the backfill flow?

**Decision**: Two critical issues found in `src/lib/sync/sources/anthropic-workspace.ts`:

1. **Workspace metadata failure aborts backfill** (line ~226): If `syncWorkspaceMetadata()` fails, the entire `run()` function returns early — costs are never synced. This should be a non-fatal warning since cost data can still be written without workspace names.

2. **No per-month error recovery** (line ~238): The month-by-month loop has no try-catch around individual `fetchAndUpsertWorkspaceCosts(month)` calls. A single month failure (e.g., API timeout) aborts the entire backfill, losing progress on already-completed months.

**Rationale**: Both issues violate FR-003 ("System MUST continue processing remaining months if a single month fails"). Fixing these is necessary for reliable backfill.

**Alternatives considered**: Retrying failed months — rejected as over-engineering. The admin can re-trigger backfill, which is idempotent.

### RQ-4: Is there any caching layer between sync writes and budget reads?

**Decision**: No. `getRunningCostsForPeriod()` queries the database directly with no caching. The backfill dialog calls `router.refresh()` after success, which re-renders the page. Data is immediately available.

**Implication**: No cache invalidation work needed.

### RQ-5: Testing patterns for sync/budget features

**Decision**: The project uses:
- **Unit tests** (Vitest): Mock DB with `vi.mock()`, test business logic. Example: `tests/unit/actions/running-costs.test.ts`
- **Integration tests** (Vitest + real DB): Seed DB, run actions, verify outcomes. Example: `tests/integration/invoice-sync.test.ts`
- **E2E tests** (Playwright): Browser automation for UI flows. Example: `tests/e2e/budget-period-running-costs.spec.ts`

Existing stub tests at `tests/integration/sync/workspace-costs.test.ts` are marked TODO — these should be implemented as part of this feature.

**Implication**: Follow existing patterns. Add unit tests for error handling changes, complete the stub integration test for workspace cost idempotency.
