# Research: Invoice Automations & Running Cost Visibility

**Feature**: 019-invoice-automations
**Date**: 2026-03-20 (updated 2026-03-24)
**Branch**: `019-invoice-automations`

---

## Session 2026-03-24: Sync UI Cleanup & Centralization

### R-NEW-1: Sync Button Removal Inventory

**Decision**: Remove all sync trigger buttons from individual pages; centralize all sync controls to Settings → Sync Status page only.

**Current scattered buttons and disposition**:

| Page | Component | Action | Disposition |
|------|-----------|--------|-------------|
| `/users` | `sync-all-button.tsx` | `syncAllAnthropicUsage()` | DELETE component + remove from page |
| `/users/[id]` | `user-detail-client.tsx` | Shows "Last synced" timestamp | KEEP display only, no button to remove |
| `/copilot/billing` | `billing-sync-button.tsx` | Triggers Copilot billing sync | DELETE component + remove from page |
| `/copilot/billing` | Inline sync history table | Shows past sync events | REMOVE section |
| `/invoices` | `sync-invoices-button.tsx` | `syncInvoices()` with dry-run | REMOVE from page, migrate dry-run to sync dashboard |
| `/settings/integrations` | `copilot-sync-section.tsx` | Enable/disable/trigger Copilot sync | REMOVE from integrations |
| `/settings/integrations` | `claude-sync-section.tsx` | `syncAllAnthropicUsage()` | REPLACE with read-only status card |
| `/settings/integrations` | GitHub sync preview/confirm | Interactive member sync | MIGRATE to sync dashboard as Sheet dialog |

**Rationale**: Centralizing eliminates admin confusion, reduces maintenance surface, and creates a single authoritative location for all sync operations.

### R-NEW-2: Settings → Integrations Page Scope Reduction

**Decision**: Integrations page shows connection management only. No sync history, triggers, or sync status.

**Retained**: GitHub connection card (org name, avatar, token status, Update Token, Disconnect), organization info.
**Removed**: CopilotSyncSection, ClaudeSyncSection, GitHub member sync preview workflow, sync history table.
**Added**: Claude Code integration status card (read-only: connected/not configured, workspace name, last API connectivity check).

**Rationale**: Separates "what am I connected to" (Integrations) from "how is my data flowing" (Sync Status).

### R-NEW-3: Sync Status Dashboard Enhancements

**Decision**: Split into scheduled/manual tables, add error popovers, toast progress, GitHub member sync Sheet.

**Architecture changes**:
- Two tables: "Scheduled Jobs" (cron-triggered, `triggeredBy IS NULL`) and "Manual Jobs" (admin-triggered, `triggeredBy IS NOT NULL`)
- Error column: truncated text with Radix `Popover` on click → full error in scrollable container
- Progress: Sonner toast on start, row polling (5s interval) with spinner, completion toast with counts
- GitHub Members "Sync Now": opens Radix `Sheet` with full interactive preview workflow

**Technical approach**:
- Extend `getSyncStatus()` or add `getSyncHistory()` action with trigger type filter
- `useEffect` + `setInterval` polling when any source shows `in_progress`
- Invoice period matching "Sync Now" gets dropdown with dry-run option (migrated from invoices page)

### R-NEW-4: GitHub Member Sync Sheet Migration

**Decision**: Extract interactive workflow from `github-integration-client.tsx` (~1000 lines) into `github-member-sync-sheet.tsx`.

**What moves**: Sync preview with 3 tabs (Matched/Unmatched GitHub/Unmatched System), resolution UI (UserSearchCombobox, InlineUserForm, UnmatchedMemberCard), conflict detection, progress tracking.
**What stays on Integrations**: Token validation, org selection, connection management (connect/disconnect/update token).
**Backend**: No changes — reuses existing `fetchGitHubSyncPreview()` and `confirmGitHubSync()` actions.

### R-NEW-5: Anthropic Workspace Sync Rename

**Decision**: Rename `anthropic_workspace_sync` → `anthropic_api_costs` everywhere.

**Affected locations**:
1. `syncSourceTypeEnum` in `schema.ts`
2. `SyncSourceType` union in `framework.ts`
3. `SOURCE_LABELS` in `sync-dashboard.tsx`
4. `BACKFILL_SOURCES` in `backfill-dialog.tsx`
5. `triggerSync` switch in `actions/sync.ts`
6. API route: `/api/sync/anthropic-workspace/` → `/api/sync/anthropic-api-costs/`
7. Seeded `sync_sources` rows
8. Existing `sync_events` rows (DB migration)

**Migration**: `ALTER TYPE sync_source_type RENAME VALUE 'anthropic_workspace_sync' TO 'anthropic_api_costs'`

### R-NEW-6: Claude Code Integration Status Card

**Decision**: New read-only card on Integrations page.

**Data sources**: `ANTHROPIC_ADMIN_API_KEY` env var → connected/not configured; lightweight API call (list workspaces, limit 1) → connectivity check; `anthropic_workspaces` table → workspace name.

**Implementation**: New server action `checkAnthropicStatus()` + API route `/api/anthropic/status`. Returns `{ connected, workspaceName?, lastCheckedAt }`. No action buttons.

### R-NEW-7: Error Popover and Progress Patterns

**Error popover**: Radix Popover on truncated error cell. Max ~50 chars with `truncate` class. PopoverContent shows full error in scrollable container (max-h-60). Keyboard accessible.

**Progress**: Toast on start → row spinner (polling 5s) → completion toast with counts. Consistent with existing Sonner usage.

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

### Decision: Use `anthropic_workspace_costs.cost_cents` as the authoritative cost source

**Decision**: The budget period detail page runs a server-side aggregation query against `anthropic_workspace_costs` for the period's date range:

```sql
SELECT SUM(cost_cents), MAX(updated_at)
FROM anthropic_workspace_costs
WHERE date >= period.startDate AND date <= period.endDate
```

The result is passed as a prop to the existing period detail component, which renders a new "Running Costs" row visually distinct from `billedCosts` rows. An optional per-workspace breakdown can be shown by adding `GROUP BY workspace_id`.

**Rationale**:
- `anthropic_workspace_costs.cost_cents` comes from Anthropic's official `cost_report` API — this is the authoritative billing cost (what Anthropic actually charges), not an approximation.
- `anthropicUsageMetrics.computedCostCents` is a derived value (tokens × pricing table) and will diverge from actual charges due to pricing changes, discounts, and rounding.
- Using the authoritative source for budget period running costs avoids misleading cost figures in financial views.
- `anthropicUsageMetrics` remains the correct source for per-user token breakdowns in the user profile view — that use case requires per-user granularity which `anthropic_workspace_costs` does not provide.

**"Last updated" timestamp**: Derived from `MAX(updated_at)` on `anthropic_workspace_costs` — reflects when the workspace cost sync last wrote data for the period's date range (FR-014).

**Zero-value periods**: Filtered out (FR-011 Acceptance Scenario 3: "zero-value entries are omitted").

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

**Decision**: Update `vercel.json` to replace the existing cron paths with the new unified sync routes:

| Source | New Path | Schedule |
|--------|----------|----------|
| GitHub Copilot billing | `/api/sync/github-copilot` | `0 6 * * *` (daily 6 AM UTC) |
| Anthropic API usage | `/api/sync/anthropic-usage` | `0 * * * *` (hourly) |
| Anthropic workspace costs | `/api/sync/anthropic-workspace` | `0 * * * *` (hourly) |
| GitHub members | Manual only (no cron) | — |
| Invoice-period matching | Manual only (no cron) | — |

**Rationale**: Anthropic usage sync moved from `*/10 * * * *` (every 10 min) to `0 * * * *` (hourly). The spec states "hourly for API usage" in its Assumptions section. This aligns with Anthropic Admin API's data freshness guarantee (~5 minutes) while reducing Vercel function invocations. The workspace sync path (`/api/sync/anthropic-workspace`) replaces the previous `/api/anthropic/workspace-sync` introduced in 018, bringing it under the unified sync route namespace.

---

## 11. 018 Integration: Workspace Cost Sync

### Context

Feature 018 (claude-global-metrics) introduced a third independent Anthropic sync mechanism alongside the two already planned for unification in 019:

- **Existing sync 1**: Per-user Anthropic API usage (sentinel row `userId = 0` in `anthropicSyncStatus`)
- **New sync (018)**: Workspace-level cost aggregates (sentinel row `userId = -1` in `anthropicSyncStatus`)

018 also added:
- `anthropic_workspaces` — workspace metadata from `GET /v1/organizations/workspaces`
- `anthropic_workspace_costs` — daily cost aggregates per workspace from `GET /v1/organizations/cost_report`, stored as integer cents. UNIQUE on `(workspace_id, date)` for named workspaces; UNIQUE on `(date)` for default workspace (`workspace_id IS NULL`).
- `anthropic_workspace_limits` — admin-configured monthly spending limits per workspace
- `anthropic_org_config` — singleton org config (billing budget limit)
- `anthropicSyncStatus.workspace_sync_completed_at` — new column tracking last successful workspace sync

The sync logic lives in `src/lib/anthropic-workspace-sync.ts` (`syncAnthropicWorkspaces()`) and ran on its own cron at `/api/anthropic/workspace-sync` every hour with a 50-minute cooldown.

### Decision: Add `anthropic_workspace_sync` as a sixth source type in the unified sync framework

**Decision**: The workspace cost sync is added to the `sync_sources` registry and `sync_events` source type enum as `anthropic_workspace_sync`, alongside the five source types already planned:
1. `github_copilot`
2. `anthropic_usage`
3. `anthropic_workspace_sync` ← new (from 018)
4. `github_members`
5. `invoice_period_match`
6. (fifth originally planned source)

The `syncAnthropicWorkspaces()` function is wrapped in the unified `SyncRunner` following the same pattern as the other sources.

**Rationale**:
- Omitting the workspace sync from the unified framework would leave a dangling independent system after migration, defeating the purpose of unification.
- The workspace sync has its own cooldown logic (50-minute guard) that maps cleanly onto the unified concurrency lock (`pg_try_advisory_lock` with a `anthropic_workspace_sync`-specific hash).
- Surfacing workspace sync status in the `/settings/sync` dashboard (FR-015) requires a `sync_events` row — without adding it as a source type, workspace sync runs would be invisible to admins.

### Decision: Migrate `userId = -1` sentinel row state into `sync_events`

**Decision**: The `anthropicSyncStatus` row with `userId = -1` (workspace sync lock) is handled identically to the `userId = 0` row (per-user usage sync lock) during the data migration:
- If `workspace_sync_completed_at IS NOT NULL`, a synthetic `sync_events` record is inserted with `sourceType = 'anthropic_workspace_sync'`, `status = 'completed'`, and `completedAt = workspace_sync_completed_at`.
- The `userId = -1` row is then dropped along with the rest of `anthropicSyncStatus`.

**Rationale**: Consistent with the Section 9 migration strategy — both sentinel rows represent the same concept (last known sync state) and both translate to a synthetic event record. Treating `userId = -1` differently would require special-case code in the migration and the post-migration lock manager.

### Decision: `anthropicSyncStatus.workspace_sync_completed_at` must not be lost in migration

**Decision**: The migration script (Section 9, step 3) is extended to explicitly handle the `workspace_sync_completed_at` column before `anthropicSyncStatus` is dropped:
- Extract `workspace_sync_completed_at` from the `userId = -1` row.
- Insert a synthetic `sync_events` record for `anthropic_workspace_sync` using this timestamp (if non-null).
- Only then proceed with `DROP TABLE anthropicSyncStatus`.

**Rationale**: SC-008 (no historical data loss) applies to all sync state, including the workspace sync timestamp. Dropping the column without capturing it would erase the last-known-good timestamp for the workspace sync, causing the first post-migration run to appear as if no previous sync ever occurred.
