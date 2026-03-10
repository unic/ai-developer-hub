# Data Model: GitHub Billing Sync

**Feature**: 015-github-billing | **Date**: 2026-03-10

## Schema Changes

### Modified: `copilot_billing_snapshots`

Re-add the `linked_billed_cost_id` column removed in Feature 014.

```
copilot_billing_snapshots
├── id                  serial PK
├── connection_id       integer FK → github_connections.id (CASCADE)
├── billing_month       date NOT NULL
├── plan_type           varchar(50) NOT NULL
├── total_seats         integer NOT NULL
├── active_seats        integer NOT NULL
├── seat_cost_cents     integer NOT NULL
├── total_cost_cents    integer NOT NULL
├── linked_billed_cost_id  integer FK → billed_costs.id (SET NULL) [NEW]
├── created_at          timestamp NOT NULL DEFAULT now()
└── updated_at          timestamp NOT NULL DEFAULT now()

Indexes:
  - UNIQUE (connection_id, billing_month)              [existing]
  - INDEX on linked_billed_cost_id                     [NEW]
```

**Field details**:
- `linked_billed_cost_id`: Nullable FK to `billed_costs.id`. Set when the billing sync creates/links a billed cost entry. NULL when no matching budget period exists. ON DELETE SET NULL (if billed cost is manually deleted, snapshot stays but loses link).

### Modified: `github_sync_events`

Add billing linking metrics.

```
github_sync_events (additions only)
├── billing_linked      integer NULL [NEW]
└── billing_skipped     integer NULL [NEW]
```

**Field details**:
- `billing_linked`: Count of billed cost entries created or updated during this sync. NULL for non-billing syncs.
- `billing_skipped`: Count of billing months skipped (no matching budget period or manual conflict). NULL for non-billing syncs.

### Unchanged: `billed_costs`

No schema changes. The `vendorReference` field (varchar(255), nullable) is used with the format `github-billing-copilot-YYYY-MM` for deduplication. No unique constraint added — lookup is by value match.

```
billed_costs (reference — no changes)
├── id                  serial PK
├── period_id           integer FK → budget_periods.id (CASCADE)
├── amount_cents        integer NOT NULL
├── invoice_date        date NOT NULL
├── description         varchar(500) NOT NULL
├── vendor_reference    varchar(255) NULL     ← used for dedup matching
├── created_at          timestamp NOT NULL DEFAULT now()
└── updated_at          timestamp NOT NULL DEFAULT now()
```

### Unchanged: `budget_periods`

No schema changes. Used for date-range matching via `findActivePeriodForDate()`.

```
budget_periods (reference — no changes)
├── id                  serial PK
├── budget_id           integer FK → annual_budgets.id (CASCADE)
├── period_label        varchar(100) NOT NULL
├── start_date          date NOT NULL
├── end_date            date NOT NULL
├── planned_amount_cents integer NOT NULL DEFAULT 0
├── created_at          timestamp NOT NULL DEFAULT now()
└── updated_at          timestamp NOT NULL DEFAULT now()
```

## Entity Relationships

```
copilotBillingSnapshots ──(optional FK)──→ billedCosts ──(required FK)──→ budgetPeriods ──→ annualBudgets
       │                                       │
       └── connectionId ──→ githubConnections   └── vendorReference = "github-billing-copilot-YYYY-MM"
```

## State Transitions

### Billing Snapshot Linking States

```
[Unlinked]  ──(sync finds matching period)──→  [Linked]
[Linked]    ──(admin deletes billed cost)──→   [Unlinked]  (SET NULL cascade)
[Linked]    ──(sync updates amount)──→         [Linked]    (same billed cost, updated amount)
[Unlinked]  ──(budget period created later, next sync)──→ [Linked]
```

### Conflict Detection States

```
For each billing month during sync:
  ├── No existing billedCost with github-billing-* ref AND no manual conflict → CREATE billed cost
  ├── Existing billedCost with matching github-billing-* ref → UPDATE billed cost
  ├── Existing billedCost with non-github-billing-* ref in same period/month → SKIP (conflict)
  └── No matching budget period → SKIP (no period)
```

## Validation Rules

- `linked_billed_cost_id` must reference a valid `billed_costs.id` or be NULL
- `billing_linked` and `billing_skipped` are non-negative integers when set
- `vendorReference` format for sync-created entries: `github-billing-copilot-YYYY-MM` (enforced in application code)
- Billing month in vendor reference must match the `invoiceDate` month of the linked billed cost

## Migration Plan

```sql
-- 1. Add linkedBilledCostId column back to copilot_billing_snapshots
ALTER TABLE copilot_billing_snapshots
  ADD COLUMN linked_billed_cost_id integer
  REFERENCES billed_costs(id) ON DELETE SET NULL;

CREATE INDEX copilot_billing_snapshots_linked_cost_idx
  ON copilot_billing_snapshots(linked_billed_cost_id);

-- 2. Add billing linking metrics to github_sync_events
ALTER TABLE github_sync_events
  ADD COLUMN billing_linked integer,
  ADD COLUMN billing_skipped integer;
```

No data migration needed — new columns are nullable and will be populated by the next sync run.
