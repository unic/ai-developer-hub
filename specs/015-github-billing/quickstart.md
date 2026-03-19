# Quickstart: GitHub Billing Sync

**Feature**: 015-github-billing | **Date**: 2026-03-10

## Prerequisites

- Node.js LTS, pnpm installed
- Neon PostgreSQL database with connection string in `.env.local`
- GitHub organization with Copilot enabled
- GitHub PAT with `manage_billing:copilot` or `admin:org` scope
- Existing GitHub connection configured in the app (Feature 013)
- At least one active annual budget with budget periods covering recent months

## Setup

```bash
# 1. Install dependencies (if new packages added)
pnpm install

# 2. Generate migration from schema changes
pnpm db:generate

# 3. Apply migration (adds linkedBilledCostId to snapshots, billing metrics to sync events)
pnpm db:migrate

# 4. Start dev server
pnpm dev
```

## Testing the Feature

### Manual Billing Sync

1. Navigate to `/copilot/billing`
2. Click "Sync Billing Now" button
3. Verify:
   - Sync progress indicator appears
   - After completion, billing rows show "Linked" badge with period name for months that have matching budget periods
   - Months without matching periods show "Unlinked" indicator
   - Any manual conflicts show "Conflict" indicator

### Verify Budget Integration

1. Navigate to the main dashboard
2. Confirm Copilot costs appear in KPI totals
3. Open a budget period detail page
4. Verify Copilot billed costs appear with description "GitHub Copilot — YYYY-MM"

### Verify Idempotency

1. Run sync twice from `/copilot/billing`
2. Check billed costs table — count should not increase on second run
3. Amounts should match the latest snapshot values

### Verify Conflict Detection

1. Manually create a billed cost entry in a budget period for a month that has Copilot billing
2. Run sync
3. Verify that month shows "Conflict" status on Copilot billing page
4. Verify the manual entry is preserved (not overwritten)

### Cron Endpoint

```bash
# Test the cron endpoint locally
curl -X POST http://localhost:3000/api/copilot/sync \
  -H "Authorization: Bearer $CRON_SECRET"
```

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/copilot-sync.ts` | Core sync pipeline — `syncBillingData()` extended with budget linking |
| `src/lib/budget-utils.ts` | Shared `findActivePeriodForDate()` utility |
| `src/lib/db/schema.ts` | Schema changes (linkedBilledCostId, billing metrics) |
| `src/actions/copilot-data.ts` | Extended billing queries with budget context |
| `src/app/copilot/billing/page.tsx` | UI changes (linked/unlinked/conflict indicators) |

## Environment Variables

No new environment variables required. Uses existing:
- `DATABASE_URL` — Neon connection string
- `CRON_SECRET` — Bearer token for cron endpoint

## Useful Commands

```bash
pnpm typecheck       # Verify TypeScript compilation
pnpm test            # Run unit tests (includes billing sync tests)
pnpm test:integration # Run integration tests (requires DB)
pnpm lint            # ESLint check
```
