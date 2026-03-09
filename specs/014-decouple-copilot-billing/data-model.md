# Data Model: Decouple Copilot Billing from Budgets

**Feature**: `014-decouple-copilot-billing`
**Date**: 2026-03-09

## Entity Changes

### Modified: Copilot Billing Snapshot

**Table**: `copilot_billing_snapshots`

**Columns removed**:

| Column | Type | Previous Purpose |
|--------|------|-----------------|
| `linked_billed_cost_id` | `integer` (nullable FK → `billed_costs.id`) | Linked snapshot to shared billing entry |

**Indexes removed**:

| Index | Columns |
|-------|---------|
| `copilot_billing_snapshots_linked_cost_idx` | `linked_billed_cost_id` |

**Relations removed**:

| Relation | Target | Type |
|----------|--------|------|
| `linkedBilledCost` | `billedCosts` | Many-to-one (optional) |

**Columns retained** (no changes):

| Column | Type | Purpose |
|--------|------|---------|
| `id` | `serial` PK | Primary key |
| `connection_id` | `integer` FK → `github_connections.id` | Owning GitHub connection |
| `billing_month` | `date` | Month this snapshot covers |
| `plan_type` | `varchar(50)` | Copilot plan (Business/Enterprise) |
| `total_seats` | `integer` | Total assigned seats |
| `active_seats` | `integer` | Seats used in the period |
| `seat_cost_cents` | `integer` | Cost per seat in cents |
| `total_cost_cents` | `integer` | Total monthly cost in cents |
| `created_at` | `timestamp` | Record creation time |
| `updated_at` | `timestamp` | Last update time |

**Unique constraint retained**: `(connection_id, billing_month)`

### Data Cleanup: Billed Costs

**Table**: `billed_costs` (no schema changes)

**Migration action**: Delete all rows where `vendor_reference LIKE 'copilot-billing-%'`

These are the entries created by the Copilot sync pipeline. After removal:
- Reports and dashboard KPIs will no longer include Copilot-sourced cost data
- Manually created billed cost entries are unaffected

### Unchanged Entities

The following entities are NOT modified by this feature:

- **`license_assignments`**: Copilot seats continue to flow in with `source = 'copilot-sync'`
- **`ai_tools`**: "GitHub Copilot" tool record continues to be created/updated by sync
- **`access_tiers`**: Business/Enterprise tiers continue to be maintained for seat references
- **`copilot_usage_metrics`**: Fully independent — no billing coupling
- **`github_sync_events`**: Sync tracking unchanged
- **`github_connections`**: Copilot sync fields (`copilot_sync_enabled`, `copilot_sync_schedule`) unchanged

## Relationship Diagram (Post-Decoupling)

```
github_connections (1) ──── (N) copilot_billing_snapshots  [DECOUPLED from billed_costs]
                   (1) ──── (N) copilot_usage_metrics
                   (1) ──── (N) github_sync_events [syncType="copilot"]

license_assignments [source="copilot-sync"] ──── users ──── github_profiles
                                             ──── ai_tools ["GitHub Copilot"]
                                             ──── access_tiers

annual_budgets (1) ──── (N) budget_periods ──── (N) billed_costs [copilot entries removed]
```

## Migration Steps

1. **Drop column**: Remove `linked_billed_cost_id` from `copilot_billing_snapshots`
2. **Drop index**: Remove `copilot_billing_snapshots_linked_cost_idx`
3. **Delete data**: Remove `billed_costs` rows where `vendor_reference LIKE 'copilot-billing-%'`

**Reversibility**: The column can be re-added. Deleted `billed_costs` entries can be re-created by re-syncing (though the future billing import feature is the intended path).
