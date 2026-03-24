# Quickstart: Global Claude Console Metrics & Budget Monitoring

**Branch**: `018-claude-global-metrics`

## Prerequisites

- `ANTHROPIC_ADMIN_API_KEY` set in `.env.local` (Admin API key starting with `sk-ant-admin...`)
- `CRON_SECRET` set in `.env.local`
- Neon PostgreSQL connection configured (`DATABASE_URL`)
- Admin account with role `admin` to access the new global metrics page

## Local Development Setup

```bash
# Install dependencies (none new — all packages already in use)
pnpm install

# Push new DB schema (3 new tables + 1 new column)
pnpm db:push

# Start dev server
pnpm dev
```

## Database Schema Changes

Run `pnpm db:push` after pulling the branch. The following are added:

| Change | Table | Details |
|--------|-------|---------|
| New table | `anthropic_workspaces` | Workspace metadata cache from Anthropic API |
| New table | `anthropic_workspace_costs` | Daily workspace cost aggregates from cost_report |
| New table | `anthropic_workspace_limits` | Admin-configured monthly spending limits |
| New column | `anthropicSyncStatus.workspaceSyncCompletedAt` | Tracks last workspace sync time |

## Triggering the Workspace Sync

The workspace sync runs automatically via the existing hourly cron job. To trigger manually:

```bash
# Trigger the existing sync endpoint (workspace sync runs if >50 min stale)
curl -X POST http://localhost:3000/api/anthropic/sync \
  -H "Authorization: Bearer $CRON_SECRET"
```

In production, Vercel Cron handles this automatically.

## Accessing the New Page

1. Log in as an admin user
2. Navigate to `/claude` (new "Claude" nav item in the admin sidebar)
3. The page shows org-wide cost data once at least one workspace sync has completed

## In-App Notification Banner

The alert banner appears automatically at the top of the content area (below the header) when:
- Any workspace reaches ≥80% of its configured monthly budget limit, OR
- Org credit data shows critically low balance (currently always "unavailable")

Dismiss the banner via the ✕ button — the dismissal persists in `localStorage` until the condition resolves and re-triggers.

## Setting Workspace Budget Limits

1. Navigate to `/claude`
2. In the "Workspace Budgets" section, click the edit icon next to any workspace
3. Enter a monthly limit in your local currency (stored as cents internally)
4. Save — the consumption indicator and warning states activate immediately

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_ADMIN_API_KEY` | Yes | Admin API key for workspace/cost sync |
| `CRON_SECRET` | Yes | Secret for cron endpoint authentication |
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string |

## Known Limitations

- **Credit balance not available**: Anthropic's Admin API does not expose org credit balance or billing budget limits. The org credits panel displays "data not available via API". This will be enabled automatically when Anthropic exposes the endpoint — no architectural changes needed.
- **Default workspace**: Workspaces with `workspace_id = null` (Anthropic's default workspace) are displayed as "Default Workspace" in the UI.
- **Historical workspace data**: Workspace cost history is only available from the date the first sync runs. There is no backfill of pre-feature historical workspace costs.

## Running Tests

```bash
# Unit tests (includes workspace sync logic, limit validation, alert threshold checks)
pnpm test

# Integration tests (real DB — workspace tables must exist)
pnpm test:integration

# E2E tests (Playwright — tests global metrics page, budget limit form, alert banner)
pnpm test:e2e
```
