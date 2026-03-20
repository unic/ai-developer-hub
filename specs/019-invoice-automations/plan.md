# Implementation Plan: Invoice Automations & Running Cost Visibility

**Branch**: `019-invoice-automations` | **Date**: 2026-03-20 | **Spec**: `specs/019-invoice-automations/spec.md`

## Summary

Replace four independent sync mechanisms (GitHub Copilot billing, GitHub member sync, Anthropic API usage sync, invoice-to-period matching) with a single unified sync framework backed by a PostgreSQL advisory lock, a shared `sync_events` event log, and a `sync_sources` registry. Build GitHub Copilot invoice auto-sync and Claude Team Plan invoice ingestion on top of that framework. Surface Claude API token costs as "running costs" alongside billed costs in the budget period view. Add a unified sync status dashboard. Include backfill support for the two API-driven sources.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode), Node.js LTS
**Primary Dependencies**: Next.js 15.5.12 (App Router), Drizzle ORM 0.45.1, NextAuth 5.0.0-beta.30, Zod 4.3.6, shadcn/ui (new-york), Recharts 2.15.4, TanStack Table 8.21.3, Sonner (toasts), Lucide React. No new packages required.
**Storage**: Neon PostgreSQL (serverless) via `@neondatabase/serverless` + Cloudflare R2 (existing, PDF blobs only — no changes)
**Testing**: Vitest (unit/integration), Playwright (E2E)
**Target Platform**: Vercel (Next.js App Router, Vercel Cron Jobs)
**Project Type**: Web application (Next.js full-stack)
**Performance Goals**: Sync operations complete within 60 seconds per source per SC-006; budget period view adds ≤50ms for running cost aggregation query
**Constraints**: No new npm packages; all external credentials remain in environment variables only; no stack traces in UI or logs
**Scale/Scope**: ~5 sync sources, ~12 months of historical data per source, ~50 users

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | ✅ PASS | All new code uses strict TypeScript; Zod validates all external API responses; no `any` |
| II. UX Consistency | ✅ PASS | Sync dashboard and running costs UI use shadcn/ui primitives exclusively |
| III. Performance Budgets | ✅ PASS | Sync operations run in background (cron/server actions); budget period view adds a single indexed aggregate query |
| IV. Accessibility-First | ✅ PASS | Dashboard table and status badges use semantic HTML; shadcn/ui components are WCAG AA compliant |
| V. Simplicity & Maintainability | ✅ PASS | Unified framework *reduces* total code surface by replacing 4 independent mechanisms; no speculative abstractions |

**No violations requiring justification.**

**Post-design re-check** (after Phase 1):
- `sync_events` + `sync_sources` tables: justified by FR-001 through FR-005; simpler than 4 separate tables.
- `src/lib/sync/framework.ts` abstraction: used by all 4 sources — not premature.
- No additional violations identified.

## Project Structure

### Documentation (this feature)

```text
specs/019-invoice-automations/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── api-contracts.md # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created by /speckit.plan)
```

### Source Code Changes

```text
src/
├── app/
│   ├── api/
│   │   ├── sync/
│   │   │   ├── github-copilot/route.ts    # NEW: cron handler (replaces /api/copilot/sync)
│   │   │   └── anthropic-usage/route.ts   # NEW: cron handler (replaces /api/anthropic/sync)
│   │   └── invoices/
│   │       └── ingest/route.ts            # NEW: external automation ingestion endpoint
│   └── (dashboard)/
│       └── settings/
│           └── sync/
│               └── page.tsx               # NEW: unified sync status dashboard
├── lib/
│   ├── db/
│   │   └── schema.ts                      # MODIFIED: add sync_sources, sync_events tables;
│   │                                      #   new enums; vendor_reference NOT NULL
│   └── sync/
│       ├── framework.ts                   # NEW: withSyncLock, retryWithBackoff, updateSyncEvent
│       ├── registry.ts                    # NEW: source lookup, advisory lock IDs
│       └── sources/
│           ├── github-copilot.ts          # NEW: copilot billing sync (extracted from copilot-sync.ts)
│           ├── anthropic-usage.ts         # NEW: usage sync (extracted from anthropic-sync.ts)
│           ├── github-members.ts          # NEW: member sync (extracted from github-sync.ts)
│           └── invoice-matching.ts        # NEW: invoice-period sync (extracted from invoice-sync.ts)
└── actions/
    └── sync.ts                            # NEW: triggerSync, triggerBackfill, getSyncStatus

vercel.json                                # MODIFIED: update cron paths to new routes
src/lib/db/migrations/
└── 0XXX_unified_sync_framework.sql        # NEW: migration + data migration + drop old tables
```

**Files to retire** (logic extracted into sync/sources/*):
- `src/lib/copilot-sync.ts` → extracted to `src/lib/sync/sources/github-copilot.ts`
- `src/lib/anthropic-sync.ts` → extracted to `src/lib/sync/sources/anthropic-usage.ts`
- `src/actions/github-sync.ts` → extracted to `src/lib/sync/sources/github-members.ts`
- `src/actions/invoice-sync.ts` → extracted to `src/lib/sync/sources/invoice-matching.ts`
- `src/app/api/copilot/sync/route.ts` → replaced by `src/app/api/sync/github-copilot/route.ts`
- `src/app/api/anthropic/sync/route.ts` → replaced by `src/app/api/sync/anthropic-usage/route.ts`

**Structure Decision**: Single-project Next.js App Router layout (existing pattern). The new `src/lib/sync/` directory follows the same structure as other domain libraries in `src/lib/`.

## Complexity Tracking

No constitution violations requiring justification.

---

## Implementation Phases

### Phase A — Schema & Framework Foundation (P1)

Delivers the unified sync framework. All subsequent phases depend on this.

**Tasks**:
1. Update `src/lib/db/schema.ts`:
   - Add `syncSourceTypeEnum`, `syncOutcomeEnum`, `syncOperationTypeEnum`
   - Add `syncSources` table
   - Add `syncEvents` table
   - Make `billedCosts.vendorReference` NOT NULL (migration default `''`)
2. Generate and write Drizzle migration including data migration SQL for `githubSyncEvents` → `sync_events` and `anthropicSyncStatus` → `sync_events`, plus `sync_sources` seed rows, plus drop old tables
3. Implement `src/lib/sync/framework.ts`:
   - `hashSourceType(sourceType): bigint` — FNV-32 hash to advisory lock ID
   - `retryWithBackoff<T>(fn, options): Promise<T>`
   - `withSyncLock(sourceType, triggeredBy, operationType, options, fn): Promise<SyncEvent>`
   - `updateSyncEvent(id, patch)` — internal helper
4. Implement `src/lib/sync/registry.ts`:
   - `getSyncSources(): Promise<SyncSourceWithLastEvent[]>`
   - `getSyncSource(type): Promise<SyncSource | null>`

**Commit**: `feat(sync): add unified sync schema, migration, and framework core`

---

### Phase B — Migrate Existing Sync Sources (P1 continued)

Extract each existing sync source into the unified framework. The old API routes remain active until Phase C updates cron paths.

**Tasks**:
1. `src/lib/sync/sources/github-copilot.ts` — extract core logic from `copilot-sync.ts`; adapt to use `withSyncLock` and `updateSyncEvent`; preserve `copilotBillingSnapshots` upsert logic; add backfill mode (date range iteration)
2. `src/lib/sync/sources/anthropic-usage.ts` — extract core logic from `anthropic-sync.ts`; replace sentinel row locking with advisory lock; add backfill mode (31-day window iteration)
3. `src/lib/sync/sources/github-members.ts` — extract from `github-sync.ts`; adapt to unified framework; no cron (manual only)
4. `src/lib/sync/sources/invoice-matching.ts` — extract from `invoice-sync.ts`; replace `pg_try_advisory_lock(839271456)` with `hashSourceType('invoice_period_matching')` from registry; no cron (manual only)
5. Add `src/actions/sync.ts` with `triggerSync`, `triggerBackfill`, `getSyncStatus` server actions

**Commit**: `feat(sync): migrate all sync sources to unified framework`

---

### Phase C — New Cron Routes & Vercel Config (P2)

Replace old cron API routes with the new unified paths.

**Tasks**:
1. Create `src/app/api/sync/github-copilot/route.ts` (GET + POST, requires cron secret)
2. Create `src/app/api/sync/anthropic-usage/route.ts` (GET + POST, requires cron secret)
3. Update `vercel.json`:
   - Replace `/api/copilot/sync` → `/api/sync/github-copilot`
   - Replace `/api/anthropic/sync` → `/api/sync/anthropic-usage`
   - Change Anthropic schedule from `*/10 * * * *` to `0 * * * *`
4. Retire old route files (delete `src/app/api/copilot/sync/route.ts` and `src/app/api/anthropic/sync/route.ts` after confirming new routes work)

**Commit**: `feat(sync): replace cron routes with unified sync handlers, update vercel.json`

---

### Phase D — Invoice Ingestion Endpoint (P3)

External automation endpoint for Claude Team Plan invoice submission.

**Tasks**:
1. Add `INVOICE_INGEST_SECRET` to `.env.example` with documentation
2. Create `src/app/api/invoices/ingest/route.ts`:
   - Validate `Authorization: Bearer {INVOICE_INGEST_SECRET}`
   - Accept `multipart/form-data` with `invoice` PDF field (max 10 MB)
   - Call existing `extractInvoiceFields()` and `checkInvoiceDuplicate()`
   - On duplicate: return 409 with `existingInvoiceId`
   - On success: upload to R2, create invoice row, call `findPeriodForDate()`, create `billedCosts` entry if period found, return 200 with result

**Commit**: `feat(invoices): add authenticated external ingestion endpoint for Claude Team Plan`

---

### Phase E — Running Costs in Budget Period View (P4)

Surface Claude API running costs alongside billed costs.

**Tasks**:
1. Add `getRunningCostsForPeriod(periodId): Promise<RunningCostSummary | null>` query to `src/actions/anthropic-usage.ts` — aggregates `computedCostCents` and `MAX(updated_at)` from `anthropicUsageMetrics` for the period's date range
2. Update the budget period detail Server Component to call `getRunningCostsForPeriod` and pass the result to the period detail UI
3. Update the period detail UI component:
   - Add "Running Costs" section (shown only when `runningCostCents > 0`)
   - Visually distinct from "Billed Costs" section (different badge/label)
   - Show "last updated" timestamp inline
   - Update period totals to show: Billed Total / Running Total / Combined Total separately

**Commit**: `feat(budget): display Claude API running costs alongside billed costs in period view`

---

### Phase F — Unified Sync Dashboard (P6)

New settings page showing all sync sources and their status.

**Tasks**:
1. Create `src/app/(dashboard)/settings/sync/page.tsx`:
   - Server Component — calls `getSyncStatus()` on load
   - Table showing all 5 sources with: source name, schedule, last run time, outcome badge, counts, error message
   - "Never synced" state for sources with no event
   - "Sync Now" button → calls `triggerSync()` server action
   - "Backfill..." button (API-driven sources only) → dialog with date picker → calls `triggerBackfill()` server action
2. Add navigation link to sync dashboard in settings sidebar
3. Display source-specific schedule next to source name (from `sync_sources.cron_schedule`)

**Commit**: `feat(dashboard): add unified sync status dashboard at /settings/sync`

---

### Phase G — Cleanup & Tests (P1–P6)

**Tasks**:
1. Delete retired source files: `src/lib/copilot-sync.ts`, `src/lib/anthropic-sync.ts`, `src/actions/github-sync.ts`, `src/actions/invoice-sync.ts`
2. Unit tests (Vitest):
   - `framework.ts`: `retryWithBackoff` (retry count, backoff timing, jitter bounds)
   - `registry.ts`: `hashSourceType` (determinism, no collisions across 5 sources)
   - Running cost query: correct date-range aggregation
3. Integration tests (Vitest, real DB):
   - `withSyncLock`: mutual exclusion (two concurrent calls to same source)
   - Invoice ingestion: dedup detection, period linking
   - Copilot sync: idempotent upsert on repeated run
4. E2E tests (Playwright):
   - Sync dashboard loads all 5 sources
   - Budget period view shows running costs section when data present
5. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`

**Commit**: `test(sync): add unit, integration, and e2e tests for unified sync framework`

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| Data migration loses `githubSyncEvents` records | Migration runs in a transaction; verified with SELECT COUNT before DROP |
| Advisory lock hash collision between sources | Unit test asserts all 5 source hashes are distinct |
| Old cron routes called after new routes deployed | Old routes deleted in Phase C; Vercel cron updated atomically with the deploy |
| `INVOICE_INGEST_SECRET` not set in production | Route returns 500 with clear error if env var is missing, not a silent bypass |
| Anthropic sync schedule change (10min → 1hr) causes data gap | Backfill can recover any missed hours; acknowledged in spec Assumptions |
