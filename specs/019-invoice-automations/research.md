# Research: Invoice Automations & Running Cost Visibility

**Feature**: 019-invoice-automations
**Date**: 2026-03-20
**Branch**: `019-invoice-automations`

---

## 1. Existing Sync Landscape (Codebase Findings)

### Current sync mechanisms — four independent systems

| Source | Trigger | Event Table | Locking Strategy | Dedup Key |
|--------|---------|-------------|-----------------|-----------|
| GitHub Copilot billing | Cron `0 6 * * *` | `githubSyncEvents` (copilot type) | Atomic INSERT race | `vendorReference` = `github-billing-copilot-YYYY-MM` |
| GitHub member sync | Manual | `githubSyncEvents` (members type) | None | N/A |
| Anthropic API usage | Cron `*/10 * * * *` | `anthropicSyncStatus` (sentinel row `userId=0`) | Sentinel row UPDATE | `(userId, date, model)` unique index |
| Invoice-period matching | Manual | None | `pg_try_advisory_lock(839271456)` | Invoice number |

### Key schema discoveries

- `billedCosts.vendorReference` (varchar 255, nullable) — existing dedup field used for Copilot billing. Must be made required (NOT NULL) for the unified approach.
- `copilotBillingSnapshots` — intermediate table with `UNIQUE(connectionId, billingMonth)`. Linked via `linkedBilledCostId` FK.
- `anthropicUsageMetrics` — already stores `computedCostCents` per `(userId, date, model)`. Running costs can be aggregated directly from here.
- `githubSyncEvents` — tracks Copilot and member syncs with an outcome enum: `in_progress | completed | partial | failed`.
- `anthropicSyncStatus` — dual-purpose: both sync lock (userId=0 sentinel) and per-user sync progress tracking.

---

## 2. Unified Sync Framework Design

### Decision: PostgreSQL advisory locks for all sources

**Decision**: Replace all three existing locking strategies (atomic INSERT race, sentinel row, advisory lock) with a single consistent approach: `pg_try_advisory_lock` with a source-type-specific integer hash.

**Rationale**:
- Advisory locks are already used by `invoice-sync.ts` — proven in this codebase.
- Non-blocking (`TRY` variant) provides the consistent "already in progress" rejection behaviour required by FR-003.
- Does not create orphan DB rows on process crash (session-level locks auto-release on disconnect).
- Integer identifiers can be derived deterministically from source type strings via a stable FNV-32 hash, no lookup table needed.

**Alternatives considered**:
- Keeping the sentinel row: rejected — leaves orphan rows on crash, requires cleanup logic.
- Distributed Redis lock: rejected — adds an external dependency not present in the stack.
- `SELECT FOR UPDATE` on a dedicated lock row: rejected — blocks the connection thread.

### Decision: Single `sync_events` table replaces all event tables

**Decision**: One `sync_events` table with `source_type` enum column replaces both `githubSyncEvents` and `anthropicSyncStatus`.

**Rationale**:
- FR-002 requires identical field structure across all source types.
- Single table enables a single query for the unified dashboard (FR-015).
- Existing `githubSyncEvents` records can be migrated via SQL INSERT SELECT.
- `anthropicSyncStatus` status can be extracted into a synthetic event row; per-user progress tracking data (not needed in the new model) can be derived from `anthropicUsageMetrics` directly.

**Alternatives considered**:
- Separate tables with a union view: rejected — requires schema changes each time a new source is added.
- JSONB payload for counts: rejected — makes typed queries harder; the count fields (created/updated/skipped/errors) are small and well-known.

### Decision: `sync_sources` registry table for schedule configuration

**Decision**: Add a `sync_sources` table as the authoritative registry of enabled sources and their cron schedules.

**Rationale**:
- FR-004 requires independent schedule configuration per source.
- Storing schedules in the DB (rather than only in `vercel.json`) allows the dashboard to display them and lets admins see configured intervals.
- `vercel.json` cron paths still point to per-source route handlers; the DB stores the human-readable schedule string for display purposes.

**Alternatives considered**:
- Config file only: rejected — no way to surface schedule info in the dashboard without parsing `vercel.json`.
- Single cron handler dispatching all sources: rejected — Vercel requires one path per cron entry, and source isolation is cleaner.

---

## 3. GitHub Copilot Billing API

### Decision: Keep existing `copilotBillingSnapshots` approach, migrate to unified framework

**Decision**: The existing Copilot billing sync already correctly calls `GET /orgs/{org}/settings/billing/usage` (GitHub REST API) and stores monthly snapshots in `copilotBillingSnapshots`. The refactor wraps this logic in the unified `SyncRunner` but does not change the data retrieval approach.

**Rationale**:
- The existing code already handles deduplication via `UNIQUE(connectionId, billingMonth)`.
- The API fields used (`billingMonth`, `totalCostCents`) are already mapped.
- Changing the data model for Copilot billing would risk losing existing snapshot data.

**Backfill approach**: The same Copilot billing API supports date-range queries. Backfill mode passes a `startDate` parameter and iterates month-by-month from start to present, applying the same idempotent upsert logic.

**Authentication**: Uses `GITHUB_TOKEN` environment variable (existing) with `manage_billing:copilot` scope — already granted.

---

## 4. Anthropic API Usage Data

### Decision: Retain existing per-day, per-user, per-model metric storage; add aggregation query for running costs

**Decision**: `anthropicUsageMetrics` remains the storage layer. Running costs for a budget period are computed via a SUM query on `computedCostCents` WHERE `date` BETWEEN `period.startDate` AND `period.endDate`. No new table is needed.

**Rationale**:
- FR-011 says "aggregate Claude API token costs by budget period date range" — this is a query, not a new storage concept.
- Materialising running costs into a separate table would create stale-data problems; the existing table is the source of truth.
- The existing `anthropic-sync.ts` already handles per-user API key resolution and cost computation.

**Backfill approach**: The Anthropic Admin API (`GET /v1/organizations/usage_report/messages`) supports `starting_at` / `ending_at` parameters. Backfill mode fetches historical day-granularity buckets, applying the same upsert logic already in `anthropic-sync.ts`. The 31-day window limit per request means the backfill iterates in 31-day windows.

**Authentication**: `ANTHROPIC_ADMIN_API_KEY` environment variable (existing).

---

## 5. Claude Team Plan Invoice Ingestion

### Decision: New `POST /api/invoices/ingest` endpoint, reusing existing PDF extraction pipeline

**Decision**: A new `POST /api/invoices/ingest` route accepts multipart PDF uploads authenticated by a pre-shared `INVOICE_INGEST_SECRET` Bearer token. It calls the same extraction pipeline (`extractInvoiceFields()`) and `checkInvoiceDuplicate()` already used by the bulk upload flow.

**Rationale**:
- FR-007 requires that both manual upload UI and external automation endpoint produce identical outcomes.
- Reusing `extractInvoiceFields()` and `checkInvoiceDuplicate()` ensures no divergence between paths.
- The `INVOICE_INGEST_SECRET` is a separate credential from `CRON_SECRET` to limit blast radius if either is compromised.

**Auth**: `Authorization: Bearer {INVOICE_INGEST_SECRET}`. Returns 401 on missing/invalid token, 409 on detected duplicate, 200 with extracted invoice data on success.

**Alternatives considered**:
- Using the existing admin session auth: rejected — external automations cannot hold a session cookie; they need a static credential.
- Webhook-style signed requests: rejected — adds complexity without meaningful security gain for this use case.

---

## 6. Exponential Backoff Retry

### Decision: Custom implementation, no new dependency

**Decision**: Implement a small `retryWithBackoff<T>` utility in `src/lib/sync/framework.ts`. No new npm package.

**Rationale**:
- The pattern is ~15 lines of TypeScript; no package justifies the dependency.
- Keeps the codebase dependency-lean (Constitution §V, Technology Standards).
- The implementation uses `Math.pow(2, attempt) * baseDelay + jitter` with a configurable `maxDelay` cap.

**Parameters**: `maxRetries: 3`, `baseDelayMs: 1_000`, `maxDelayMs: 8_000`, `jitter: up to 500ms`. Matches the spec's intent without excessive wait time within a Vercel function timeout.

---

## 7. Budget Period View — Running Costs Display

### Decision: Server Component aggregation query; no client-side state needed

**Decision**: The budget period detail page runs a server-side `SELECT SUM(computed_cost_cents)` against `anthropicUsageMetrics` for the period's date range. The result is passed as a prop to the existing period detail component, which renders a new "Running Costs" row visually distinct from `billedCosts` rows.

**Rationale**:
- No new API endpoint needed — the period detail page is a Server Component.
- The "last updated" timestamp (FR-014) is derived from `MAX(updatedAt)` on the same query.
- Zero-value periods are filtered out (FR-011 Acceptance Scenario 3: "zero-value entries are omitted").

---

## 8. Sync Status Dashboard

### Decision: New settings sub-page at `/settings/sync`

**Decision**: A new page at `app/(dashboard)/settings/sync/page.tsx` displays all registered `sync_sources` rows joined with their latest `sync_events` record. Manual trigger and backfill initiation use Server Actions.

**Rationale**:
- Keeps routing consistent with the existing settings section pattern.
- Server Component with Server Actions means no new API routes for the dashboard itself.
- The unified `sync_events` table makes this a single JOIN query.

---

## 9. Data Migration

### Decision: SQL migration script in `db/migrations/`; migrate-on-deploy

**Decision**: A Drizzle migration (generated via `pnpm db:generate`) includes:
1. CREATE TABLE `sync_sources`, `sync_events` with new enums.
2. INSERT INTO `sync_events` SELECT from `githubSyncEvents` (mapped columns).
3. INSERT INTO `sync_events` a synthetic final-state record for each `anthropicSyncStatus` row where `lastSyncCompletedAt IS NOT NULL`.
4. Seed `sync_sources` rows for all five source types.
5. DROP TABLE `githubSyncEvents`, DROP TABLE `anthropicSyncStatus` — after data is verified in the migration transaction.

**Rationale**:
- SC-008 requires no historical data loss. Wrapping in a transaction ensures atomic migration.
- Drizzle migrations are the established pattern in this codebase (confirmed in `CLAUDE.md`).

---

## 10. Vercel Cron Schedule Updates

**Decision**: Update `vercel.json` to replace the two existing cron paths with the new unified sync routes:

| Source | New Path | Schedule |
|--------|----------|----------|
| GitHub Copilot billing | `/api/sync/github-copilot` | `0 6 * * *` (daily 6 AM UTC) |
| Anthropic API usage | `/api/sync/anthropic-usage` | `0 * * * *` (hourly) |
| GitHub members | Manual only (no cron) | — |
| Invoice-period matching | Manual only (no cron) | — |

**Rationale**: Anthropic usage sync moved from `*/10 * * * *` (every 10 min) to `0 * * * *` (hourly). The spec states "hourly for API usage" in its Assumptions section. This aligns with Anthropic Admin API's data freshness guarantee (~5 minutes) while reducing Vercel function invocations.
