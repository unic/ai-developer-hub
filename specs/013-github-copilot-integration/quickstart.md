# Quickstart: GitHub Copilot Integration

**Feature**: 013-github-copilot-integration
**Date**: 2026-03-09

## Prerequisites

- Existing dev environment running (`pnpm dev`)
- Neon PostgreSQL database accessible
- GitHub organization with Copilot Business or Enterprise subscription
- GitHub Personal Access Token with scopes: `read:org`, `read:user`, `manage_billing:copilot`

## Development Setup

### 1. Database Migration

After schema changes, push to dev database:

```bash
pnpm db:generate   # Generate migration for new tables + columns
pnpm db:push       # Apply to dev database
```

New tables: `copilot_usage_metrics`, `copilot_billing_snapshots`
Modified tables: `github_connections` (+2 columns), `license_assignments` (+1 column), `github_sync_events` (+4 columns + new enum)

### 2. Environment Variables

Add to `.env.local` (already gitignored):

```env
# Existing — no changes needed
API_KEY_ENCRYPTION_SECRET=...   # Used for token encryption
NEXTAUTH_SECRET=...             # Auth secret

# New — for scheduled sync
CRON_SECRET=...                 # Shared secret for cron endpoint auth
```

### 3. Feature File Structure

```text
src/
├── actions/
│   ├── copilot.ts              # Connection management (enable/disable/trigger sync)
│   └── copilot-data.ts         # Data query actions (overview, seats, billing, analytics)
├── lib/
│   ├── copilot-sync.ts         # Sync pipeline (billing → seats → metrics)
│   └── copilot-api.ts          # GitHub Copilot API wrapper functions
├── app/
│   ├── copilot/
│   │   ├── layout.tsx          # Tab bar layout (Overview, Seats, Billing, Analytics)
│   │   ├── page.tsx            # Overview dashboard (default tab)
│   │   ├── copilot-tab-bar.tsx # Tab navigation component
│   │   ├── seats/
│   │   │   ├── page.tsx        # Seat allocation table
│   │   │   └── [userId]/
│   │   │       └── page.tsx    # Individual seat detail
│   │   ├── billing/
│   │   │   └── page.tsx        # Billing dashboard
│   │   └── analytics/
│   │       └── page.tsx        # Usage analytics
│   └── api/
│       └── copilot/
│           └── sync/
│               └── route.ts    # Cron-triggered sync endpoint
├── components/
│   └── copilot/
│       ├── overview-cards.tsx       # KPI summary cards
│       ├── usage-trend-chart.tsx    # Suggestions/acceptances over time
│       ├── seats-table.tsx          # Seat allocation data table
│       ├── billing-trend-chart.tsx  # Monthly cost trend
│       ├── cost-utilization-chart.tsx # Cost vs. acceptance rate
│       ├── language-chart.tsx       # Language breakdown bar chart
│       ├── editor-chart.tsx         # Editor breakdown chart
│       ├── activity-distribution.tsx # User activity levels
│       └── copilot-sync-section.tsx # Settings page Copilot section
└── lib/db/
    └── migrations/
        └── 0007_*.sql          # New migration for Copilot tables + columns
```

### 4. Development Order

Build in this sequence (each step is independently testable):

1. **Schema + Migration** — New tables, modified columns, new enum
2. **Copilot API wrapper** — GitHub API functions (billing, seats, metrics)
3. **Sync pipeline** — Core sync logic (billing → seats → metrics)
4. **Settings UI** — Copilot section on integrations page (enable/disable/sync status)
5. **Copilot layout + tab bar** — Shared layout for all Copilot pages
6. **Overview dashboard** — KPI cards + trend chart
7. **Seats table + detail** — Data table with filters + detail page
8. **Billing dashboard** — Cost cards + trend + ROI charts
9. **Analytics dashboard** — Language, editor, activity breakdowns
10. **Scheduled sync** — API route + cron configuration
11. **Budget backfill** — billedCosts creation when budget exists

### 5. Testing Approach

- **Unit tests**: Sync pipeline logic, data transformations, metric aggregations
- **Integration tests**: API wrapper with mock GitHub responses, database operations
- **E2E tests**: Enable sync flow, dashboard rendering, date range selection
- **Manual testing**: Requires real GitHub org with Copilot — use a test org or mock API responses during development

### 6. Key Patterns to Follow

- Server Actions return `ActionResult<T>` (see `src/types/index.ts`)
- Admin-only actions use `requireAdmin()` guard
- Charts use `ChartContainer` + `ChartConfig` (see `src/components/ui/chart.tsx`)
- Data tables use `DataTable` component (see `src/components/data-table.tsx`)
- Monetary values stored as integers (cents)
- Token encryption via `encryptApiKey`/`decryptApiKey` (see `src/lib/crypto.ts`)
- Change history via `recordCreation`/`recordUpdate` (see `src/actions/history.ts`)
- Cache invalidation via `revalidatePath()` after mutations
