# Research: GitHub Billing Sync

**Feature**: 015-github-billing | **Date**: 2026-03-10

## Decision Log

### D1: Upsert Strategy for Billed Costs

**Decision**: Use `vendorReference` field lookup (SELECT + conditional INSERT/UPDATE) rather than `onConflictDoUpdate()`.

**Rationale**: The `vendorReference` column on `billedCosts` has no unique constraint, and adding one would break existing invoice-linked entries that may share vendor references. Instead, the sync will:
1. Query `billedCosts` WHERE `vendorReference = 'github-billing-copilot-YYYY-MM'` AND `periodId` matches
2. If found: UPDATE the existing row (amount, description, updatedAt)
3. If not found: INSERT a new row

This matches the spec's FR-004 upsert requirement while respecting the existing schema.

**Alternatives considered**:
- `onConflictDoUpdate()` on vendorReference: Requires adding a unique index, which could conflict with manual invoice entries using the same reference pattern.
- Separate dedup table: Over-engineered for the scope (Constitution V: Simplicity).

### D2: Re-linking Copilot Billing Snapshots to Billed Costs

**Decision**: Re-add `linkedBilledCostId` column to `copilotBillingSnapshots` table.

**Rationale**: Feature 014 removed this column to decouple. Feature 015 re-establishes the link through a robust, idempotent mechanism. The column enables:
- Direct navigation from Copilot billing dashboard to budget context
- Efficient queries for the "linked/unlinked" status indicator (FR-006)
- No need for pattern-matching joins at query time

The new column is nullable (snapshots without matching budget periods remain unlinked). An index supports dashboard lookups.

**Alternatives considered**:
- Derive linkage via vendorReference JOIN at query time: Slower for dashboard queries, requires complex pattern matching, fragile.
- Store linkage in a separate mapping table: Over-engineered (Constitution V).

### D3: Conflict Detection for Manual Entries

**Decision**: Before creating a billed cost, check if a non-sync entry already exists for the same budget period with a similar date range (same month). Use `vendorReference NOT LIKE 'github-billing-%'` to identify manual entries.

**Rationale**: Per clarification, sync must skip months with manual entries and flag a conflict. The approach:
1. For each billing month, find the matching budget period
2. Check if any `billedCosts` entry exists for that period where `vendorReference` does NOT start with `github-billing-` AND `invoiceDate` falls in the same month
3. If found: skip and record conflict in sync result
4. If not found: proceed with upsert

**Alternatives considered**:
- Check only exact vendorReference match: Would miss manually entered entries with different reference formats.
- Always overwrite: Rejected per clarification (admin trust).

### D4: Backfill Strategy (12-Month History)

**Decision**: On first billing sync (when no `billedCosts` with `github-billing-copilot-*` vendor reference exist), iterate over existing `copilotBillingSnapshots` (up to 12 months back) and create corresponding `billedCosts` entries.

**Rationale**: The Copilot sync pipeline already stores monthly snapshots. Backfill uses this existing data rather than making additional API calls. This is efficient and works even if the GitHub API's historical data is limited.

**Alternatives considered**:
- Fetch historical data from GitHub API: The Copilot billing endpoint returns current state only, not historical invoices. Snapshots are the authoritative source.
- Skip backfill entirely: Would miss months already synced before this feature, creating an incomplete budget picture.

### D5: Extending Existing Cron Endpoint

**Decision**: Extend the existing `/api/copilot/sync` cron route to include billing-to-budget linking as part of `syncBillingData()`.

**Rationale**: The billing sync naturally belongs in the existing Copilot sync pipeline. No new cron endpoint is needed. The `syncBillingData()` function is extended with a new step that runs after the snapshot upsert. This keeps the single sync orchestration point and reuses stale-run cleanup, concurrency prevention, and status tracking.

**Alternatives considered**:
- Separate cron endpoint for billing sync: Adds operational complexity, requires separate CRON_SECRET or shared auth, harder to coordinate with Copilot sync.
- Background job queue: No existing infrastructure; adding one violates Constitution V (Simplicity) for a single periodic task.

### D6: Vendor Reference Format

**Decision**: Use format `github-billing-copilot-YYYY-MM` (e.g., `github-billing-copilot-2026-01`).

**Rationale**: This format:
- Includes the product name for future extensibility (Actions, Packages)
- Includes year-month for deduplication matching
- Matches the prefix `github-billing-` used in Feature 014's cleanup migration, maintaining consistency
- Is human-readable in the billed costs table

**Alternatives considered**:
- UUID-based references: Not human-readable, harder to debug.
- Numeric IDs: No semantic meaning, cannot detect product or month from reference alone.

### D7: Sync Result Tracking

**Decision**: Add `billingLinked` count to the existing sync event tracking (alongside `billingProcessed`, `seatsProcessed`, `metricsProcessed`).

**Rationale**: The `githubSyncEvents` table already tracks per-step counts. Adding a `billingLinked` count (number of billed cost entries created/updated) and `billingSkipped` count (conflicts/no matching period) provides visibility without schema changes — these can be stored in the existing `errorMessage` field as structured text, or added as new nullable integer columns.

**Decision detail**: Add two new nullable integer columns to `githubSyncEvents`:
- `billing_linked` — count of billed costs created or updated
- `billing_skipped` — count of months skipped (no period or conflict)

This is cleaner than parsing errorMessage and enables dashboard queries.

## Technology Patterns Confirmed

| Pattern | Source | Reuse Strategy |
|---------|--------|----------------|
| `onConflictDoUpdate()` for snapshots | `copilot-sync.ts:120-144` | Keep existing snapshot upsert unchanged |
| `findActivePeriodForDate()` | `invoices.ts:136-157` | Extract to shared utility, reuse for billing sync |
| `recordCreation()` / `recordUpdate()` | `history.ts:8-42` | Call for each billed cost created/updated |
| Stale-run cleanup (10 min) | `api/copilot/sync/route.ts:34-50` | Reuse as-is |
| Atomic INSERT with NOT EXISTS | `api/copilot/sync/route.ts:52-63` | Reuse as-is for concurrency |
| Bearer token auth (CRON_SECRET) | `api/copilot/sync/route.ts:8-16` | Reuse as-is |

## Open Items

None — all NEEDS CLARIFICATION items resolved in spec clarifications.
