# Data Model: Running API Costs in Budget View

**Branch**: `025-running-api-costs` | **Date**: 2026-03-27

## Entities

### No Schema Changes Required

This feature operates entirely on existing tables. No new tables, columns, or migrations are needed.

### Existing Entities Used

#### `anthropic_workspace_costs` (read + write)
- **Role**: Stores monthly cost totals per workspace. Written by both regular sync (current month) and backfill (historical months).
- **Key fields**: `workspace_id` (nullable), `date` (YYYY-MM-01), `cost_cents` (integer)
- **Unique constraints**: Partial unique indexes on (workspace_id, date) handle NULL workspace_id correctly
- **Upsert behavior**: ON CONFLICT DO UPDATE SET cost_cents, updated_at

#### `anthropic_workspaces` (read only)
- **Role**: Workspace metadata (names, colors, archived status). Joined to workspace_costs for display names.
- **Key fields**: `workspace_id`, `name`, `is_default`, `is_archived`

#### `budget_periods` (read only)
- **Role**: Time spans within annual budgets. Running costs are matched by date overlap.
- **Key fields**: `id`, `start_date`, `end_date`, `budget_id`

#### `sync_events` (write)
- **Role**: Audit trail for sync/backfill operations.
- **Key fields**: `source_type`, `operation_type`, `outcome`, `created_count`, `updated_count`, `error_count`, `error_message`

## Data Flow

```
Anthropic Cost Report API
  → fetchAndUpsertWorkspaceCosts(month)
    → UPSERT anthropic_workspace_costs (per workspace, per month)

Budget Detail Page
  → getRunningCostsForPeriod(periodId)
    → SELECT SUM(cost_cents) FROM anthropic_workspace_costs
       WHERE date >= period.start_date AND date <= period.end_date
    → Returns { runningCostCents, source, workspaceBreakdown }

Budget Overview Page (NEW)
  → For each budget: aggregate running costs across all periods
    → Display combined "Actual (incl. API)" totals
```

## Validation Rules

- `cost_cents` must be >= 0 (enforced by CHECK constraint)
- `date` must be first-of-month format (enforced by application code)
- Backfill start date must not exceed 24 months ago (enforced by `triggerBackfill()`)
- Advisory lock prevents concurrent sync/backfill for same source type
