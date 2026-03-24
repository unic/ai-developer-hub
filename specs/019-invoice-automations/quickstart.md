# Quickstart: Invoice Automations & Running Cost Visibility

**Feature**: 019-invoice-automations
**Branch**: `019-invoice-automations`

---

## Prerequisites

- Node.js LTS + pnpm installed
- `.env.local` with the following values set (see `.env.example`):

```
DATABASE_URL=                    # Neon PostgreSQL connection string
CRON_SECRET=                     # Existing — Vercel cron auth
INVOICE_INGEST_SECRET=           # NEW — external invoice ingestion auth
GITHUB_TOKEN=                    # GitHub PAT (manage_billing:copilot scope)
ANTHROPIC_ADMIN_API_KEY=         # Anthropic Admin API key
CLOUDFLARE_R2_*                  # Existing R2 credentials for PDF storage
```

---

## Setup

```bash
# 1. Install dependencies (no new packages needed)
pnpm install

# 2. Apply the unified sync framework migration
pnpm db:generate   # generates migration from schema changes
pnpm db:migrate    # runs all pending migrations (includes data migration)

# 3. Start dev server
pnpm dev
```

---

## Key Routes

| Path | Description |
|------|-------------|
| `/settings/sync` | Unified sync status dashboard — sole location for all sync triggers |
| `/settings/integrations` | Connection management only (GitHub + Claude Code status card) |
| `/api/invoices/ingest` | External invoice ingestion endpoint |
| `/api/sync/github-copilot` | Cron handler — Copilot billing sync |
| `/api/sync/anthropic-usage` | Cron handler — Anthropic usage sync |
| `/api/sync/anthropic-api-costs` | Cron handler — Anthropic API costs sync (renamed from anthropic-workspace) |
| `/api/anthropic/status` | Anthropic API connectivity check (for integrations card) |

---

## Testing the Invoice Ingestion Endpoint

```bash
# Submit a Claude Team Plan PDF invoice via curl
curl -X POST http://localhost:3000/api/invoices/ingest \
  -H "Authorization: Bearer your-ingest-secret" \
  -F "invoice=@/path/to/invoice.pdf"

# Expected: 200 with invoice data, or 409 if duplicate
```

---

## Triggering a Manual Sync

Navigate to `/settings/sync` — this is the **only** place in the app where sync can be triggered. Click "Sync Now" on any source. For backfill, click "Backfill..." and enter a start date.

For GitHub Members, "Sync Now" opens a full-page dialog with the interactive preview workflow (match/create/skip) before executing.

For Invoice Period Matching, "Sync Now" offers a dropdown with a dry-run preview option.

---

## Verifying Running Costs

1. Navigate to any budget period that overlaps with a month where Claude API usage has been synced.
2. The period detail shows a "Running Costs" section below the billed costs list.
3. The section includes a "last updated" timestamp.
4. If no Claude API usage exists for the period, the section is not shown.

---

## Architecture Summary

```
src/lib/sync/
├── framework.ts              # Core: advisory lock, event log, retry
├── registry.ts               # Source registration and lookup
└── sources/
    ├── github-copilot.ts     # Copilot billing sync implementation
    ├── anthropic-usage.ts    # Anthropic API usage sync implementation
    ├── anthropic-workspace.ts # Anthropic API costs sync (renamed from workspace)
    ├── github-members.ts     # GitHub member sync implementation
    └── invoice-matching.ts   # Invoice-to-period matching implementation

src/app/api/sync/
├── github-copilot/route.ts       # Vercel cron handler
├── anthropic-usage/route.ts      # Vercel cron handler
└── anthropic-api-costs/route.ts  # Vercel cron handler (renamed)

src/app/api/invoices/ingest/
└── route.ts                  # External automation ingestion endpoint

src/app/api/anthropic/status/
└── route.ts                  # Connectivity check for integrations card

src/app/settings/sync/
├── page.tsx                  # Sync status dashboard (sole sync control point)
├── sync-dashboard.tsx        # Split tables + error popovers + progress toasts
├── scheduled-jobs-table.tsx  # Cron-triggered job history
├── manual-jobs-table.tsx     # Admin-triggered job history
├── error-popover.tsx         # Click-to-expand error cell
└── github-member-sync-sheet.tsx  # Full-page dialog for interactive member sync

src/app/settings/integrations/
├── page.tsx                       # Connection management only
├── github-integration-client.tsx  # GitHub connection (no sync)
└── claude-code-status-card.tsx    # Read-only Anthropic status card
```

The `framework.ts` provides three building blocks used by all sync sources:

1. **`withSyncLock(sourceType, fn)`** — acquires `pg_try_advisory_lock`, creates the `sync_events` row as `in_progress`, runs `fn`, updates the event row with the outcome, releases the lock.
2. **`retryWithBackoff(fn, options)`** — retries a failing async function with exponential backoff + jitter.
3. **`updateSyncEvent(id, patch)`** — updates counts and outcome on the running event row.

Each source implementation exports a single `run(eventId, options?)` function that is called by the framework after lock acquisition.

---

## Common Issues

**"Sync already in progress"** — A previous sync is still holding the advisory lock. Wait for it to complete or check the sync dashboard for a stuck `in_progress` event (may indicate a crashed process; advisory locks auto-release on disconnect).

**"Source not found or disabled"** — The `sync_sources` table may not have been seeded. Run `pnpm db:migrate` to apply the seed migration.

**"Unauthorized" on `/api/invoices/ingest`** — Verify `INVOICE_INGEST_SECRET` in `.env.local` matches the Bearer token in the request.
