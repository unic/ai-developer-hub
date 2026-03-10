# Data Model: GitHub Copilot Integration

**Feature**: 013-github-copilot-integration
**Date**: 2026-03-09

## Existing Table Modifications

### `githubConnections` — Add Copilot sync fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `copilotSyncEnabled` | boolean | `false` | Whether Copilot data syncing is active |
| `copilotSyncSchedule` | varchar(50) | `"daily"` | Sync frequency ("daily", "twice_daily", "manual_only") |

No existing columns modified or removed.

### `licenseAssignments` — Add source discriminator

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `source` | varchar(50) | `"manual"` | Origin of assignment: "manual" or "copilot-sync" |

Existing records default to "manual". Sync-managed records set to "copilot-sync" and are read-only in the UI.

### `githubSyncEvents` — Add sync type discriminator

New enum `copilotSyncTypeEnum`: `"members"` | `"copilot"`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `syncType` | copilot_sync_type_enum | `"members"` | Distinguishes member syncs from Copilot syncs |

Existing records default to "members". Copilot syncs use "copilot".

**Additional Copilot-specific count fields** (nullable, only populated for Copilot syncs):

| Field | Type | Description |
|-------|------|-------------|
| `seatsProcessed` | integer | Number of Copilot seats synced |
| `metricsProcessed` | integer | Number of daily metric records synced |
| `billingProcessed` | integer | Number of billing snapshot records synced |

## New Tables

### `copilotUsageMetrics` — Daily org-level usage data

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | serial | PK | Auto-incrementing primary key |
| `connectionId` | integer | NOT NULL | FK → `githubConnections.id` (CASCADE) |
| `date` | date | NOT NULL | Calendar date of the metric |
| `totalActiveUsers` | integer | NOT NULL | Users who received at least one suggestion |
| `totalEngagedUsers` | integer | NOT NULL | Users who accepted at least one suggestion |
| `totalSuggestions` | integer | NOT NULL | Total code suggestions shown |
| `totalAcceptances` | integer | NOT NULL | Total code suggestions accepted |
| `totalLinesSuggested` | integer | NOT NULL | Total lines of code suggested |
| `totalLinesAccepted` | integer | NOT NULL | Total lines of code accepted |
| `totalChatTurns` | integer | | Total IDE chat interactions |
| `totalChatAcceptances` | integer | | Code from chat that was accepted |
| `totalDotcomChatTurns` | integer | | GitHub.com chat interactions |
| `totalPrSummaries` | integer | | PR summaries generated |
| `languageBreakdown` | jsonb | | Array of `{ language, suggestions, acceptances, linesSuggested, linesAccepted }` |
| `editorBreakdown` | jsonb | | Array of `{ editor, engagedUsers, suggestions, acceptances }` |
| `createdAt` | timestamp | NOT NULL | Record creation time (DEFAULT now()) |

**Indexes**:
- `copilot_usage_metrics_connection_date_idx` UNIQUE on (`connectionId`, `date`) — deduplication key
- `copilot_usage_metrics_date_idx` on (`date`) — for date range queries

**Uniqueness rule**: One record per connection per date. Re-syncing the same date upserts (updates existing record).

### `copilotBillingSnapshots` — Monthly billing data

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | serial | PK | Auto-incrementing primary key |
| `connectionId` | integer | NOT NULL | FK → `githubConnections.id` (CASCADE) |
| `billingMonth` | date | NOT NULL | First day of the billing month (e.g., 2026-03-01) |
| `planType` | varchar(50) | NOT NULL | "business" or "enterprise" |
| `totalSeats` | integer | NOT NULL | Total seats allocated |
| `activeSeats` | integer | NOT NULL | Seats active this billing cycle |
| `seatCostCents` | integer | NOT NULL | Monthly cost per seat in cents |
| `totalCostCents` | integer | NOT NULL | Total monthly cost in cents (`totalSeats × seatCostCents`) |
| `linkedBilledCostId` | integer | | FK → `billedCosts.id` (SET NULL) — link to budget system |
| `createdAt` | timestamp | NOT NULL | Record creation time (DEFAULT now()) |
| `updatedAt` | timestamp | NOT NULL | Last update time (DEFAULT now()) |

**Indexes**:
- `copilot_billing_snapshots_connection_month_idx` UNIQUE on (`connectionId`, `billingMonth`) — deduplication key
- `copilot_billing_snapshots_linked_cost_idx` on (`linkedBilledCostId`)

**Uniqueness rule**: One record per connection per billing month. Re-syncing the same month upserts.

## Entity Relationships

```text
githubConnections (1) ──── (N) copilotUsageMetrics
                   (1) ──── (N) copilotBillingSnapshots
                   (1) ──── (N) githubSyncEvents [syncType = "copilot"]

copilotBillingSnapshots (N) ──── (0..1) billedCosts [via linkedBilledCostId]

githubProfiles (1) ──── (1) users ──── (N) licenseAssignments [source = "copilot-sync"]

aiTools [name = "GitHub Copilot"] (1) ──── (N) accessTiers [Business, Enterprise]
                                   (1) ──── (N) licenseAssignments [source = "copilot-sync"]
```

## State Transitions

### Copilot Sync Lifecycle

```
Disabled ──[admin enables]──→ Enabled (Idle)
Enabled (Idle) ──[schedule/manual trigger]──→ Syncing (In Progress)
Syncing ──[all data categories complete]──→ Enabled (Idle) [sync event: "completed"]
Syncing ──[partial failure]──→ Enabled (Idle) [sync event: "partial"]
Syncing ──[total failure]──→ Enabled (Idle) [sync event: "failed"]
Enabled ──[admin disables]──→ Disabled [data preserved]
Any ──[credentials invalid]──→ Enabled (Error) [admin notified]
```

### Copilot License Assignment Lifecycle

```
[Seat assigned in GitHub] ──[sync]──→ Active (source: copilot-sync)
Active ──[tier changes in GitHub]──→ Active (new tier, cost snapshot updated)
Active ──[seat removed in GitHub]──→ Inactive (revokedAt set, historical data preserved)
Inactive ──[seat re-assigned]──→ Active (new assignment created)
```

### Billing Snapshot Lifecycle

```
[Billing data synced] ──→ Snapshot stored
Snapshot ──[matching budget period exists]──→ billedCosts entry created, linkedBilledCostId set
Snapshot ──[no matching budget]──→ Snapshot stored, linkedBilledCostId null
[Budget later created] ──[backfill]──→ billedCosts entry created, linkedBilledCostId updated
```

## Validation Rules

- `copilotUsageMetrics.date`: Must be a valid past date (not future)
- `copilotBillingSnapshots.billingMonth`: Must be first day of a month
- `copilotBillingSnapshots.totalCostCents`: Must equal `totalSeats × seatCostCents`
- `copilotBillingSnapshots.seatCostCents`: Must be positive integer (cents)
- `licenseAssignments.source`: Must be "manual" or "copilot-sync"
- `githubSyncEvents.syncType`: Must be "members" or "copilot"
- Mutual exclusion: No two `githubSyncEvents` with `syncType = "copilot"` and `status = "in_progress"` for the same `connectionId`

## Data Volume Estimates

For an organization with 5,000 Copilot users:

| Table | Growth Rate | 1 Year Volume |
|-------|-------------|---------------|
| `copilotUsageMetrics` | 1 row/day | ~365 rows |
| `copilotBillingSnapshots` | 1 row/month | ~12 rows |
| `licenseAssignments` (Copilot) | Up to 5,000 active | ~5,000 rows |
| `githubSyncEvents` (Copilot) | 1 row/sync (~365/year) | ~365 rows |

JSONB fields (`languageBreakdown`, `editorBreakdown`) may contain 20-50 entries each. Total storage per metrics row: ~2-5 KB.
