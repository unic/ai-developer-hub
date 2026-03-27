# Quickstart: Multiple Claude API Plan Connections

**Feature**: 026-multiple-api-plans
**Date**: 2026-03-27

## Prerequisites

- Node.js LTS, pnpm installed
- Neon PostgreSQL database accessible
- `API_KEY_ENCRYPTION_SECRET` env var set (existing requirement)
- `ANTHROPIC_ADMIN_API_KEY` env var set (will be auto-imported as first plan)

## Setup

```bash
# 1. Checkout feature branch
git checkout 026-multiple-api-plans

# 2. Install dependencies (no new packages needed)
pnpm install

# 3. Generate and apply migration
pnpm db:generate
pnpm db:migrate

# 4. Start dev server
pnpm dev
```

## Verify Migration

After running `pnpm db:migrate`:

1. Check that `anthropic_plan_connections` table exists with one row (auto-imported from env var)
2. Check that `anthropic_usage_metrics` rows have `plan_connection_id` populated
3. Check that `anthropic_workspaces` rows have `plan_connection_id` populated

## Test Plan Connections

1. Navigate to `/settings/integrations`
2. See the auto-imported plan in the connections list
3. Click "Add Plan" to add a second connection with a different Anthropic admin API key
4. Verify both plans appear with their labels and "Connected" status

## Test Sync

1. Navigate to `/claude` dashboard
2. Trigger a manual sync — should iterate both plans
3. Check sync events show separate entries per plan
4. Verify workspace costs aggregate across plans

## Test User Profile

1. Assign a user an API key that belongs to Plan B
2. Run sync
3. View user's profile — should show usage data (no plan label visible)
4. View user's admin detail page — should show plan label next to usage

## Key Files to Watch

| Area | File | What Changed |
|------|------|-------------|
| Schema | `src/lib/db/schema.ts` | New table + column additions |
| Migration | `drizzle/XXXX_add_plan_connections.sql` | DDL + backfill |
| Plan CRUD | `src/actions/plan-connections.ts` | New server actions |
| Sync | `src/lib/anthropic-sync.ts` | Plan iteration loop |
| Sync | `src/lib/anthropic-keys.ts` | Accept admin key param |
| Profile | `src/lib/profile-data.ts` | Join plan label |
| UI | `src/app/settings/integrations/` | Plan management card |
| Dashboard | `src/components/claude/global-metrics-client.tsx` | Plan filter |
