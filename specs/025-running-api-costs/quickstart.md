# Quickstart: Running API Costs in Budget View

**Branch**: `025-running-api-costs` | **Date**: 2026-03-27

## Overview

This feature fixes error handling in the existing Anthropic API costs backfill and adds running API cost totals to the budget overview page. No schema changes. No new dependencies.

## Prerequisites

- Node.js LTS + pnpm
- Neon PostgreSQL database with existing schema
- Anthropic Admin API key configured
- Existing budget with budget periods

## Dev Setup

```bash
git checkout 025-running-api-costs
pnpm install
pnpm dev
```

## Key Files to Modify

1. `src/lib/sync/sources/anthropic-workspace.ts` — Fix backfill error handling
2. `src/app/budget/page.tsx` — Add running cost fetching to overview
3. `src/app/budget/budget-list-client.tsx` (or equivalent) — Display running costs in overview

## Key Files to Read (Context)

- `src/lib/budget-utils.ts` — `getRunningCostsForPeriod()` function
- `src/app/budget/[id]/page.tsx` — How detail page fetches running costs (pattern to follow)
- `src/app/budget/[id]/budget-detail-client.tsx` — How detail page displays running costs

## Testing

```bash
pnpm test                    # Unit tests
pnpm test:integration        # Integration tests (real DB)
pnpm test:e2e                # E2E tests (Playwright)
```

## Verification

1. Trigger backfill for `anthropic_api_costs` from Settings > Sync
2. Navigate to Budget overview — historical periods should show "Actual (incl. API)"
3. Navigate to Budget detail — all periods should show running API costs
4. Re-run backfill — verify no duplicates, same totals
