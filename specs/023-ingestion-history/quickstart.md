# Quickstart: Ingestion History Tab

**Feature**: 023-ingestion-history | **Date**: 2026-03-26

## Prerequisites

- Node.js LTS, pnpm installed
- Neon PostgreSQL database configured in `.env.local`
- R2 credentials configured (for document download testing)

## Setup

```bash
# 1. Switch to feature branch
git checkout 023-ingestion-history

# 2. Install dependencies (no new packages required)
pnpm install

# 3. Generate and apply the new migration
pnpm db:generate
pnpm db:migrate

# 4. Start dev server
pnpm dev
```

## Verify

1. Navigate to `http://localhost:3000/settings/ingestion` (must be logged in as admin)
2. The Ingestion tab should appear in the settings navigation
3. Upload an invoice via `/invoices/new` — it should appear in the ingestion history
4. Submit a duplicate invoice — the failed attempt should appear with error details

## Key Files

| Area | Path |
|------|------|
| DB schema | `src/lib/db/schema.ts` (ingestion_log table) |
| Migration | `src/lib/db/migrations/0014_add_ingestion_log.sql` |
| Settings page | `src/app/settings/ingestion/page.tsx` |
| History table | `src/app/settings/ingestion/ingestion-history-table.tsx` |
| Server action | `src/actions/ingestion-log.ts` |
| Shared components | `src/components/error-popover.tsx`, `src/components/outcome-badge.tsx` |
| API ingest hook | `src/app/api/invoices/ingest/route.ts` (modified) |
| Manual upload hook | `src/actions/invoices.ts` (modified) |

## Testing

```bash
# Type check
pnpm typecheck

# Unit tests
pnpm test

# Lint
pnpm lint
```
