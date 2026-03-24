# Data Model: Global Claude Console Metrics & Budget Monitoring

**Feature**: 018-claude-global-metrics
**Date**: 2026-03-20

## New Tables

### anthropic_workspaces

Caches workspace metadata fetched from `GET /v1/organizations/workspaces`. One row per workspace returned by the Anthropic API, plus one synthetic row for the default workspace (where `workspaceId` is null).

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | serial | PK, auto-increment | Row identifier |
| workspaceId | varchar(100) | NULLABLE, UNIQUE | Anthropic-assigned workspace ID. NULL represents the default workspace (API keys with `workspace_id: null`). Stored as a true SQL NULL — not the string "null". |
| name | varchar(200) | NOT NULL | Display name from Anthropic API, or "Default Workspace" for the null sentinel row |
| displayColor | varchar(20) | NULLABLE | Hex color string from Anthropic API (e.g., "#6366f1"). NULL for default workspace. |
| isDefault | boolean | NOT NULL, DEFAULT false | True only for the synthetic default-workspace row (workspaceId IS NULL) |
| isArchived | boolean | NOT NULL, DEFAULT false | True if `archived_at` is non-null in the API response |
| archivedAt | timestamp | NULLABLE | Timestamp from `archived_at` field in the API response |
| anthropicCreatedAt | timestamp | NULLABLE | Workspace creation time from the Anthropic API `created_at` field |
| lastSeenAt | timestamp | NOT NULL, DEFAULT now() | Updated each time a sync confirms this workspace still exists in the API response |
| createdAt | timestamp | NOT NULL, DEFAULT now() | Row creation time in this database |
| updatedAt | timestamp | NOT NULL, DEFAULT now() | Row last update time in this database |

**Unique constraint**: (workspaceId) — enforced with a partial unique index that treats NULL as a distinct value. In PostgreSQL, NULLs are not considered equal by standard unique constraints, so a filtered unique index `WHERE workspace_id IS NULL` prevents multiple default-workspace rows.

**Indexes**:
- `idx_anthropic_workspaces_workspace_id` UNIQUE on (workspaceId) WHERE workspaceId IS NOT NULL
- `idx_anthropic_workspaces_is_default` UNIQUE on (isDefault) WHERE isDefault = true — ensures at most one default-workspace sentinel row
- `idx_anthropic_workspaces_archived` on (isArchived) — fast filter for active workspaces

**Notes**:
- There is exactly one row where `workspaceId IS NULL` and `isDefault = true`. This row is upserted during workspace sync to represent usage/costs from API keys not assigned to a named workspace.
- Archived workspaces are retained in the table (isArchived = true) so historical cost data remains joinable. They are excluded from the active workspace list by default.
- The `lastSeenAt` field enables detection of workspaces that have disappeared from the API (not the same as being archived via the API).

---

### anthropic_workspace_costs

Stores daily workspace-level cost aggregates from `GET /v1/organizations/cost_report?group_by[]=workspace_id`. One row per workspace per day. This is permanent historical storage, not a cache.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | serial | PK, auto-increment | Row identifier |
| workspaceId | varchar(100) | NULLABLE | Anthropic workspace ID. NULL = default workspace (matches `anthropic_workspaces.workspaceId IS NULL`). No FK constraint — workspaceId may appear in cost data before the workspace sync has run. |
| date | date | NOT NULL | The calendar date of the cost aggregate |
| costCents | integer | NOT NULL, DEFAULT 0 | Total cost in USD cents for this workspace on this date. Converted from the USD float returned by the cost report API (`round(usd * 100)`). Never negative. |
| createdAt | timestamp | NOT NULL, DEFAULT now() | Row creation time |
| updatedAt | timestamp | NOT NULL, DEFAULT now() | Row last update time |

**Unique constraint**: (workspaceId, date) — requires a two-part index strategy to handle NULL:

- `idx_anthropic_workspace_costs_workspace_date` UNIQUE on (workspaceId, date) WHERE workspaceId IS NOT NULL
- `idx_anthropic_workspace_costs_default_date` UNIQUE on (date) WHERE workspaceId IS NULL — ensures one default-workspace row per date

**Indexes**:
- `idx_anthropic_workspace_costs_date` on (date) — enables date-range queries across all workspaces
- `idx_anthropic_workspace_costs_workspace_id` on (workspaceId) — enables per-workspace queries

**Notes**:
- No FK to `anthropic_workspaces` by design. The cost report sync may run independently of the workspace list sync. Dangling workspaceId values are resolved lazily when the workspace list sync runs.
- `costCents` uses integer (not bigint) because daily per-workspace costs are unlikely to exceed $21 million ($2,147,483,647 cents). If this assumption changes, migrate to bigint.
- The cost report API returns costs in USD as a floating-point number. Conversion: `Math.round(usdValue * 100)`. This is the only place floating-point appears — it is immediately converted and never stored.
- Today's row is upserted on each sync (costs accumulate during the day). Past days are also upserted to correct any retroactive adjustments from Anthropic.

---

### anthropic_workspace_limits

Admin-configured monthly spending limits per workspace. Stored in this application — not synced from or to Anthropic. One row per workspace that has a limit configured; workspaces with no row have no limit set.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | serial | PK, auto-increment | Row identifier |
| workspaceId | varchar(100) | NULLABLE, UNIQUE | Anthropic workspace ID. NULL = default workspace. Same NULL semantics as `anthropic_workspace_costs`. |
| limitCents | integer | NOT NULL | Monthly spending limit in USD cents. Must be > 0. Calendar-month aligned (resets at start of each month). |
| createdAt | timestamp | NOT NULL, DEFAULT now() | When this limit was first configured |
| updatedAt | timestamp | NOT NULL, DEFAULT now() | When this limit was last changed |

**Unique constraint** (same pattern as workspace costs):
- `idx_anthropic_workspace_limits_workspace_id` UNIQUE on (workspaceId) WHERE workspaceId IS NOT NULL
- `idx_anthropic_workspace_limits_default` UNIQUE on (id) WHERE workspaceId IS NULL — at most one default-workspace limit row (using a constant expression ensures uniqueness)

**Notes**:
- No limit history. Each upsert overwrites the previous value. `updatedAt` provides an audit trail of when the limit was last changed.
- Removing a limit deletes the row entirely (not a soft delete).
- Limit enforcement is advisory — the application surfaces alerts when spending approaches or exceeds the limit. The app does not block Anthropic API calls.
- `limitCents` must be > 0 at the application layer (Zod validation). The database does not enforce a check constraint, to avoid the overhead of a constraint migration for a business rule that may evolve.

---

### anthropic_org_config

Stores org-level configuration manually entered by administrators. One row only (singleton table). Currently holds the manually configured Anthropic billing budget limit, which is stable and infrequently changed.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | integer | PK, DEFAULT 1 | Always 1 — singleton row enforced via CHECK (id = 1) |
| billingBudgetLimitCents | integer | NULLABLE | The org-level monthly billing budget limit in USD cents, manually set by an admin. NULL if not yet configured. Must be > 0 when set. |
| updatedAt | timestamp | NOT NULL, DEFAULT now() | When this config was last updated |
| updatedBy | integer | NULLABLE, FK → users.id | Admin user who last updated the config |

**Unique constraint**: `id` is the primary key. Only one row can exist. The application upserts this row (INSERT ... ON CONFLICT (id) DO UPDATE).

**Notes**:
- This value is not synced from Anthropic — it is entered manually because the Anthropic Admin API does not expose the billing budget limit programmatically.
- Expected to be stable and changed rarely (e.g., when the contract with Anthropic is renewed or renegotiated).
- When `billingBudgetLimitCents` is NULL, the org budget progress indicator is hidden (equivalent behavior to workspace limits with no row).
- The same warning (≥80%) and critical (≥100%) thresholds apply as for workspace limits: org total spend vs. this configured limit.

---

## Modified Tables

### anthropicSyncStatus

Add one column to track the workspace list + costs sync separately from the per-user usage sync.

| New Field | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| workspaceSyncCompletedAt | timestamp | NULLABLE | Timestamp of the last successful workspace list + cost data sync. Written only to the sentinel row where `userId = -1`. NULL until the first workspace sync completes. |

**Sentinel row convention**:
- `userId = 0` — existing global lock for the user usage sync (established in feature 016)
- `userId = -1` — new sentinel row for the workspace sync lock

The `userId = -1` sentinel row uses the same concurrency-guard pattern as `userId = 0`:
1. Before starting a workspace sync, check if the `userId = -1` row has `lastSyncStartedAt` within the last 60 seconds with no corresponding `lastSyncCompletedAt` → sync in progress, return early
2. Set `lastSyncStartedAt = now()` before calling the Anthropic API
3. On success, set both `lastSyncCompletedAt = now()` and `workspaceSyncCompletedAt = now()`
4. On failure, set `lastSyncError` with the error message

No FK constraint on `userId` in `anthropicSyncStatus` (already established in 016) — sentinel negative values are valid.

**Drizzle migration**: Add the column as nullable with no default. Existing rows are unaffected.

---

## Relationships

```
anthropic_workspaces (NEW)
  └── workspaceId ←→ anthropic_workspace_costs.workspaceId  (logical join, no FK)
  └── workspaceId ←→ anthropic_workspace_limits.workspaceId (logical join, no FK)

anthropic_workspace_costs (NEW)
  └── (workspaceId, date) — unique per-workspace-per-day

anthropic_workspace_limits (NEW)
  └── workspaceId — at most one limit per workspace

anthropicSyncStatus (MODIFIED)
  └── userId = -1 sentinel row tracks workspace sync state
  └── userId = 0  sentinel row tracks global user usage sync (existing, unchanged)
  └── userId > 0  per-user rows (existing, unchanged)
```

The three new tables intentionally omit foreign key constraints between them:
- `anthropic_workspace_costs.workspaceId` has no FK to `anthropic_workspaces` because cost syncs and workspace syncs run independently. Costs for an unknown workspace are stored and linked after the next workspace sync.
- `anthropic_workspace_limits.workspaceId` has no FK to `anthropic_workspaces` because an admin may configure a limit before the workspace list has been synced.

Application code is responsible for consistency: `getWorkspaceList()` left-joins all three tables on `workspaceId` (with NULL-safe comparison) to produce a unified view.

---

## Validation Rules

- `anthropic_workspaces.workspaceId`: varchar(100) or NULL; never the empty string
- `anthropic_workspaces.name`: non-empty string; "Default Workspace" used when the API returns no name for the null-workspace row
- `anthropic_workspace_costs.costCents`: integer ≥ 0 (costs are never negative; a zero-cost day is valid)
- `anthropic_workspace_limits.limitCents`: integer > 0 (enforced at the server action layer via Zod: `z.number().int().positive()`)
- `month` parameter accepted by dashboard actions: ISO year-month string `YYYY-MM`, validated with `z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)`. Defaults to current calendar month if omitted.

---

## State Transitions

### Workspace Limit Lifecycle

```
[No limit row]
    │
    │  setWorkspaceLimit(workspaceId, limitCents > 0)
    ▼
[Limit configured]   ←──  setWorkspaceLimit(workspaceId, newValue)  ──┐
    │                                                                   │
    │  setWorkspaceLimit(workspaceId, null)                            │
    ▼                                                                   │
[Row deleted]  ──────────────────────────────────────────────────────▶ (reconfigure)
```

### Workspace Sync Lifecycle

```
[No sentinel row]
    │
    │  First workspace sync triggered (manual or cron)
    ▼
[userId=-1 row created, lastSyncStartedAt set]
    │
    ├── success → lastSyncCompletedAt set, workspaceSyncCompletedAt set
    │
    └── failure → lastSyncError set, lastSyncCompletedAt remains NULL
                  → next trigger will retry (stale lock cleared after 5 min)
```

### Workspace Archival Lifecycle

```
[Active workspace row: isArchived=false]
    │
    │  Workspace archived in Anthropic Console
    │  → next workspace list sync detects archived_at is non-null
    ▼
[isArchived=true, archivedAt set]
    │
    │  Row is never deleted — historical cost data remains joinable
    │  UI filters archived workspaces from the active list by default
```

---

## Migration Notes

- All three new tables (`anthropic_workspaces`, `anthropic_workspace_costs`, `anthropic_workspace_limits`) are net-new. No existing data migration is needed.
- The `workspaceSyncCompletedAt` column added to `anthropicSyncStatus` is nullable with no default — the `ALTER TABLE ADD COLUMN` migration is non-blocking on Neon PostgreSQL.
- Existing `anthropicUsageMetrics` data is not migrated or modified. Per-user token data (from the usage report endpoint) and per-workspace cost data (from the cost report endpoint) are complementary datasets that live in separate tables. There is no conversion path from one to the other.
- The `userId = -1` sentinel row in `anthropicSyncStatus` is created lazily on the first workspace sync trigger, not by the migration.
- Partial unique indexes (the `WHERE workspaceId IS NOT NULL` pattern) are used throughout. Drizzle 0.45.1 supports partial indexes via the `.where()` modifier on `uniqueIndex()`.
