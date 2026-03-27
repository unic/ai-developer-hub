# Implementation Plan: Running API Costs in Budget View

**Branch**: `025-running-api-costs` | **Date**: 2026-03-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/025-running-api-costs/spec.md`

## Summary

Enable the Anthropic API costs backfill to reliably populate historical months so the budget view shows a complete cost picture. Fix two error handling gaps in the backfill loop, and add running API cost totals to the budget overview page summary cards.

No schema changes. No new dependencies. Three files modified, tests added.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode)
**Primary Dependencies**: Next.js 15.5.12 (App Router), Drizzle ORM 0.45.1, React 19.2.4
**Storage**: Neon PostgreSQL (serverless) — no schema changes
**Testing**: Vitest (unit/integration), Playwright (e2e)
**Target Platform**: Web (Node.js server + browser client)
**Project Type**: Web application (Next.js App Router)
**Performance Goals**: Budget overview page renders within existing LCP < 2.5s budget
**Constraints**: No new tables or migrations; builds on existing sync framework
**Scale/Scope**: Typically 12 budget periods per year; 1-5 workspaces; up to 24 months backfill

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | All changes in TypeScript strict mode. Existing types reused. |
| II. UX Consistency | PASS | Budget overview uses same card/grid layout as existing summary. "Actual (incl. API)" label matches detail page pattern. |
| III. Performance Budgets | PASS | Overview adds N parallel DB queries (N = number of periods, typically 12). Each query is a simple SUM aggregate — sub-millisecond. Well within LCP budget. |
| IV. Accessibility-First | PASS | No new interactive elements. Existing semantic markup used. |
| V. Simplicity & Maintainability | PASS | No new abstractions. Reuses `getRunningCostsForPeriod()`. Error handling fix is straightforward try-catch. |

**Post-Phase 1 re-check**: All gates still pass. No new complexity introduced.

## Project Structure

### Documentation (this feature)

```text
specs/025-running-api-costs/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0 research findings
├── data-model.md        # Phase 1 data model (no changes)
├── quickstart.md        # Developer quickstart guide
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── sync/
│   │   └── sources/
│   │       └── anthropic-workspace.ts    # FIX: backfill error handling
│   └── budget-utils.ts                   # READ ONLY: existing getRunningCostsForPeriod()
├── app/
│   └── budget/
│       ├── page.tsx                      # MODIFY: add running cost fetching to overview
│       └── [id]/
│           ├── page.tsx                  # READ ONLY: pattern reference for running costs
│           └── budget-detail-client.tsx  # READ ONLY: pattern reference for display

tests/
├── unit/
│   └── sync/
│       └── anthropic-workspace-backfill.test.ts  # NEW: backfill error handling tests
├── integration/
│   └── sync/
│       └── workspace-costs.test.ts               # COMPLETE: existing stub
└── e2e/
    └── budget-period-running-costs.spec.ts       # EXTEND: verify overview shows API costs
```

**Structure Decision**: All changes fit within existing directory structure. No new directories needed.

## Implementation Phases

### Phase A: Fix Backfill Error Handling (US-1, FR-001, FR-002, FR-003)

**File**: `src/lib/sync/sources/anthropic-workspace.ts`

**Change 1 — Non-fatal workspace metadata sync** (~line 222-227):
- Currently: If `syncWorkspaceMetadata()` throws, the `run()` function returns early — costs are never synced.
- Fix: Wrap metadata sync in try-catch. On failure, log warning, increment `errorCount`, set `errorMessage`, but continue to cost sync. Workspace names may show as IDs in the UI, but cost data is still accurate.

**Change 2 — Per-month error recovery in backfill loop** (~line 230-240):
- Currently: No try-catch around individual `fetchAndUpsertWorkspaceCosts(month)` calls. One month failure aborts entire backfill.
- Fix: Wrap each month's call in try-catch. On failure, increment `errorCount`, append month to `errorMessage`, continue to next month. After loop, set outcome to "partial" if any months failed.

**Commit checkpoint**: After both changes, commit with message describing error handling improvements.

### Phase B: Budget Overview Running Costs (US-3, FR-005, FR-006)

**File**: `src/app/budget/page.tsx`

**Change 3 — Fetch running costs for active budget periods** (~line 30-34):
- After loading `activeBudgetWithCosts`, fetch running costs for each period using the same `Promise.all()` + `getRunningCostsForPeriod()` pattern used in the detail page.
- Compute `totalRunning` by summing all running costs.

**Change 4 — Display "Actual (incl. API)" in summary cards** (~line 116-121):
- Replace or augment the "Billed" summary card:
  - If running costs exist: show `totalBilled + totalRunning` with label "Actual (incl. API)"
  - If no running costs: show `totalBilled` with label "Billed" (unchanged)
- Update variance calculation to use `totalBilled + totalRunning` when running costs exist.

**Commit checkpoint**: After overview changes, commit with message describing budget overview enhancement.

### Phase C: Tests (SC-001 through SC-004)

**New file**: `tests/unit/sync/anthropic-workspace-backfill.test.ts`
- Test: Workspace metadata failure does not prevent cost sync
- Test: Single month API failure does not abort backfill; remaining months still sync
- Test: Error counts and messages correctly reflect partial failures
- Test: Successful backfill with no errors sets outcome to "success"

**Complete stub**: `tests/integration/sync/workspace-costs.test.ts`
- Test: Backfill upserts are idempotent (run twice, same row count and amounts)
- Test: Backfill creates rows for each month in range

**Extend**: `tests/e2e/budget-period-running-costs.spec.ts`
- Test: Budget overview page shows "Actual (incl. API)" when running costs exist

**Commit checkpoint**: After tests pass, commit with message describing test additions.

### Phase D: Verification & Regression (US-2, FR-004)

- Run full test suite (`pnpm test`, `pnpm test:integration`)
- Verify regular sync still works (no regression from error handling changes)
- Verify backfill end-to-end: trigger from UI, check budget detail and overview
- Run typecheck and lint (`pnpm typecheck && pnpm lint`)

**Final commit**: Any cleanup or adjustments from verification.

## Complexity Tracking

No constitution violations. No complexity justifications needed.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Backfill error handling changes break normal sync | Low | High | US-2 regression tests; normal sync path is separate from backfill branch |
| Budget overview N+1 queries slow page load | Low | Medium | N is typically 12; each query is a simple SUM aggregate. Monitor LCP. |
| Anthropic API rate limiting during backfill | Medium | Low | Existing sequential month-by-month iteration naturally throttles. Per-month error recovery prevents total failure. |
