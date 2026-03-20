# Data Model: Invoice Automations & Running Cost Visibility

**Feature**: 019-invoice-automations
**Date**: 2026-03-20

---

## New Enums

### `sync_source_type`

```sql
CREATE TYPE sync_source_type AS ENUM (
  'github_copilot_billing',   -- GitHub Copilot invoices via billing API
  'anthropic_api_usage',      -- Claude API token consumption via Admin API
  'anthropic_team_invoices',  -- Claude Team Plan — manual upload or ingest endpoint
  'github_members',           -- GitHub org member data
  'invoice_period_matching'   -- Invoice-to-budget-period auto-linking
);
```

### `sync_outcome`

```sql
CREATE TYPE sync_outcome AS ENUM (
  'in_progress',  -- Sync is currently running
  'success',      -- All records processed without errors
  'partial',      -- Some records succeeded, some failed
  'failed'        -- All records failed or fatal error
);
```

### `sync_operation_type`

```sql
CREATE TYPE sync_operation_type AS ENUM (
  'regular',   -- Scheduled or manually triggered standard sync
  'backfill'   -- Historical import from a specified start date
);
```

---

## New Tables

### `sync_sources` — Registered sync source registry

```
sync_sources
├── id               serial PK
├── source_type      sync_source_type NOT NULL UNIQUE
├── enabled          boolean NOT NULL DEFAULT true
├── cron_schedule    varchar(100)          -- Display-only (cron expression string)
├── created_at       timestamp NOT NULL DEFAULT now()
└── updated_at       timestamp NOT NULL DEFAULT now()
```

**Indexes**: `UNIQUE INDEX` on `source_type`

**Notes**:
- Seeded at migration time with one row per source type.
- `cron_schedule` is informational (mirrors `vercel.json`); actual scheduling is done by Vercel.
- `enabled = false` means cron invocations return early without processing.

### `sync_events` — Unified sync event log

```
sync_events
├── id                 serial PK
├── source_type        sync_source_type NOT NULL
├── operation_type     sync_operation_type NOT NULL DEFAULT 'regular'
├── backfill_start_date date                    -- NULL for regular syncs
├── outcome            sync_outcome NOT NULL DEFAULT 'in_progress'
├── started_at         timestamp NOT NULL DEFAULT now()
├── completed_at       timestamp                -- NULL until finished
├── triggered_by       integer → users(id)      -- NULL = cron-triggered
├── created_count      integer NOT NULL DEFAULT 0
├── updated_count      integer NOT NULL DEFAULT 0
├── skipped_count      integer NOT NULL DEFAULT 0
├── error_count        integer NOT NULL DEFAULT 0
├── error_message      text                    -- Human-readable, no stack traces
└── created_at         timestamp NOT NULL DEFAULT now()
```

**Indexes**:
- `INDEX` on `source_type`
- `INDEX` on `outcome`
- `INDEX` on `started_at DESC`
- `INDEX` on `(source_type, started_at DESC)` — for latest-per-source queries

**Replaces**: `githubSyncEvents`, `anthropicSyncStatus` (lock + status roles)

---

## Modified Tables

### `billed_costs` — Add NOT NULL constraint on `vendor_reference`

Current state: `vendor_reference varchar(255)` (nullable)

Change: Make `vendor_reference NOT NULL` with a migration default of `''` (empty string for any legacy rows without a reference). Going forward, all automated sync paths MUST supply a stable, non-empty vendor reference.

**Deduplication keys by source**:
| Source | `vendor_reference` format |
|--------|--------------------------|
| GitHub Copilot billing | `github-billing-copilot-YYYY-MM` |
| Claude Team Plan invoice | `anthropic-team-inv-{invoiceNumber}` |

**Note**: A `UNIQUE INDEX` on `vendor_reference` is NOT added — the field can legitimately be empty (e.g., manually entered costs). Deduplication is enforced at the application layer via `ON CONFLICT DO UPDATE` targeting the vendor reference on insert paths that supply one. For manual entries, the field remains an optional hint.

---

## Unchanged Tables (referenced for context)

### `invoices` — Existing invoice storage (no change)

```
invoices
├── id                   serial PK
├── invoice_number       varchar(255)         -- Dedup key for Claude Team Plan
├── invoice_date         date
├── amount_cents         integer
├── vendor               varchar(255)
├── linked_billed_cost_id integer → billed_costs(id) (nullable)
├── blob_url             text
├── blob_pathname        text
├── uploaded_by          integer → users(id)
├── created_at           timestamp
└── updated_at           timestamp
```

### `copilot_billing_snapshots` — Existing (no change)

```
copilot_billing_snapshots
├── id                    serial PK
├── connection_id         integer → github_connections(id)
├── billing_month         date                  -- First day of billing month
├── plan_type             varchar(50)
├── total_seats           integer
├── active_seats          integer
├── seat_cost_cents       integer
├── total_cost_cents      integer
├── linked_billed_cost_id integer → billed_costs(id) (nullable)
├── created_at            timestamp
└── updated_at            timestamp
-- UNIQUE INDEX on (connection_id, billing_month)
```

### `anthropic_usage_metrics` — Existing (no change); used for running cost aggregation

```
anthropic_usage_metrics
├── id                          serial PK
├── user_id                     integer → users(id)
├── date                        date
├── model                       varchar(100)
├── uncached_input_tokens       bigint
├── cache_read_input_tokens     bigint
├── cache_creation_input_tokens bigint
├── output_tokens               bigint
├── computed_cost_cents         integer
├── pricing_resolved            boolean
├── created_at                  timestamp
└── updated_at                  timestamp
-- UNIQUE INDEX on (user_id, date, model)
```

**Running cost query** (used in budget period view):
```sql
SELECT
  SUM(computed_cost_cents) AS running_cost_cents,
  MAX(updated_at)          AS last_updated_at
FROM anthropic_usage_metrics
WHERE date >= :period_start_date
  AND date <= :period_end_date;
```

---

## Entity Relationships

```
sync_sources (1) ──< sync_events (many)     via source_type match (no FK — log is append-only)
sync_events.triggered_by >── users.id       nullable FK

billed_costs.period_id >── budget_periods.id
invoices.linked_billed_cost_id >── billed_costs.id  (nullable)
copilot_billing_snapshots.linked_billed_cost_id >── billed_costs.id (nullable)

anthropic_usage_metrics aggregated by period date range → "running cost" (computed, not stored)
```

---

## Migration Plan

**Migration file**: `src/lib/db/migrations/0XXX_unified_sync_framework.sql`

### Step 1: Create new enums
```sql
CREATE TYPE sync_source_type AS ENUM (...);
CREATE TYPE sync_outcome AS ENUM (...);
CREATE TYPE sync_operation_type AS ENUM (...);
```

### Step 2: Create new tables
```sql
CREATE TABLE sync_sources (...);
CREATE TABLE sync_events (...);
```

### Step 3: Migrate githubSyncEvents → sync_events
```sql
INSERT INTO sync_events (
  source_type, operation_type, outcome,
  started_at, completed_at, triggered_by,
  created_count, updated_count, skipped_count,
  error_count, error_message, created_at
)
SELECT
  CASE sync_type
    WHEN 'copilot'  THEN 'github_copilot_billing'::sync_source_type
    WHEN 'members'  THEN 'github_members'::sync_source_type
  END,
  'regular'::sync_operation_type,
  CASE status
    WHEN 'completed' THEN 'success'::sync_outcome
    WHEN 'partial'   THEN 'partial'::sync_outcome
    WHEN 'failed'    THEN 'failed'::sync_outcome
    WHEN 'in_progress' THEN 'in_progress'::sync_outcome
  END,
  started_at,
  completed_at,
  triggered_by,
  COALESCE(billing_linked, seats_processed, 0),  -- created_count
  0,                                              -- updated_count (not tracked historically)
  COALESCE(billing_skipped, 0),                  -- skipped_count
  0,                                              -- error_count
  error_message,
  started_at
FROM github_sync_events;
```

### Step 4: Migrate anthropicSyncStatus → sync_events (final state only)
```sql
-- For each non-lock anthropic sync status row, create one synthetic completed event
INSERT INTO sync_events (
  source_type, operation_type, outcome,
  started_at, completed_at,
  synced_count, created_at
)
SELECT
  'anthropic_api_usage'::sync_source_type,
  'regular'::sync_operation_type,
  CASE
    WHEN last_sync_error IS NOT NULL THEN 'failed'::sync_outcome
    WHEN last_sync_completed_at IS NOT NULL THEN 'success'::sync_outcome
    ELSE 'in_progress'::sync_outcome
  END,
  last_sync_started_at,
  last_sync_completed_at,
  COALESCE(synced_days, 0),
  last_sync_started_at
FROM anthropic_sync_status
WHERE user_id != 0   -- exclude the global lock sentinel row
  AND last_sync_started_at IS NOT NULL;
```

### Step 5: Seed sync_sources registry
```sql
INSERT INTO sync_sources (source_type, enabled, cron_schedule) VALUES
  ('github_copilot_billing',  true,  '0 6 * * *'),
  ('anthropic_api_usage',     true,  '0 * * * *'),
  ('anthropic_team_invoices', true,  NULL),
  ('github_members',          true,  NULL),
  ('invoice_period_matching', true,  NULL);
```

### Step 6: Drop old tables (within same migration transaction)
```sql
DROP TABLE github_sync_events;
DROP TABLE anthropic_sync_status;
DROP TYPE github_sync_status;
DROP TYPE copilot_sync_type;
```

---

## Validation Rules

### `sync_events`
- `backfill_start_date` MUST be non-null if and only if `operation_type = 'backfill'`
- `completed_at` MUST be non-null if `outcome != 'in_progress'`
- `error_message` SHOULD be set if `outcome = 'failed'` or `outcome = 'partial'`
- `error_message` MUST NOT contain stack traces or raw error codes

### `sync_sources`
- `cron_schedule` is nullable — sources without automated scheduling leave it null

### `billed_costs`
- `vendor_reference` MUST be non-null and non-empty for all rows created by automated sync paths
- Manually created `billed_costs` rows may leave `vendor_reference` null/empty

---

## State Transitions

### Sync Event Lifecycle

```
[trigger]
    │
    ▼
outcome = 'in_progress'  ──── pg_try_advisory_lock fails ──→ REJECT (409)
    │
    │  (processing)
    │
    ├── all records ok ──────────────────────────────────→ outcome = 'success'
    ├── some records failed ─────────────────────────────→ outcome = 'partial'
    └── fatal error / all retries exhausted ─────────────→ outcome = 'failed'
```

### Lock lifecycle

```
pg_try_advisory_lock(hash(source_type))
    │
    ├── acquired ──→ run sync ──→ pg_advisory_unlock(hash(source_type))
    └── not acquired ──→ return "sync already in progress" error
```
