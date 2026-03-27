# Data Model: Multiple Claude API Plan Connections

**Feature**: 026-multiple-api-plans
**Date**: 2026-03-27

## New Entities

### `anthropic_plan_connections`

Represents a connected Claude API plan with its encrypted admin API key.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | serial | PK | Auto-incrementing identifier |
| label | varchar(200) | NOT NULL | Human-readable name (e.g., "Engineering Plan") |
| adminApiKeyEncrypted | varchar(700) | NOT NULL | AES-256-GCM encrypted admin API key (same pattern as `licenseAssignments.apiKeyEncrypted`) |
| adminApiKeyHint | varchar(20) | NOT NULL | Masked key for display (e.g., "sk-a••••••••1234") |
| status | enum | NOT NULL, default 'active' | `active` or `disconnected` |
| disconnectedAt | timestamp | nullable | When the plan was disconnected |
| createdAt | timestamp | NOT NULL, default now() | Creation timestamp |
| updatedAt | timestamp | NOT NULL, default now() | Last update timestamp |
| createdBy | integer | FK → users.id | Admin who added the connection |

**Indexes**:
- Unique: `adminApiKeyHint` WHERE `status = 'active'` (prevent duplicate active connections)
- Index: `status`

**Enum**: `anthropic_plan_status` = `['active', 'disconnected']`

**State transitions**:
- `active` → `disconnected` (admin removes plan; sets `disconnectedAt`)
- No transition back — reconnecting creates a new row

---

## Modified Entities

### `anthropic_usage_metrics` — Add plan association

| New Field | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| planConnectionId | integer | NOT NULL, FK → anthropic_plan_connections.id | Which plan this usage was sourced from |

**Index changes**:
- Drop existing unique index on `(user_id, date, model)`
- Add unique index on `(user_id, date, model, plan_connection_id)`
- Update composite index: `(user_id, date)` → `(user_id, date, plan_connection_id)`

**Migration**: Backfill all existing rows with the auto-imported first plan connection's ID.

---

### `anthropic_sync_status` — Add plan scoping

| New Field | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| planConnectionId | integer | NOT NULL, default 0 | Which plan this sync status tracks (0 = legacy sentinel compatibility) |

**Index changes**:
- Drop existing unique index on `user_id`
- Add unique index on `(user_id, plan_connection_id)`

**Migration**: Backfill all existing rows with the auto-imported first plan connection's ID. The sentinel row (userId=0) gets the first plan's ID.

---

### `anthropic_workspaces` — Add plan association

| New Field | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| planConnectionId | integer | NOT NULL, FK → anthropic_plan_connections.id | Which plan owns this workspace |

**Index changes**:
- Drop existing unique index on `workspace_id WHERE workspace_id IS NOT NULL`
- Add unique index on `(workspace_id, plan_connection_id) WHERE workspace_id IS NOT NULL`
- Drop existing unique index on `is_default WHERE is_default = true`
- Add unique index on `(plan_connection_id, is_default) WHERE is_default = true` (one default per plan)

**Migration**: Backfill all existing rows with the auto-imported first plan connection's ID.

---

### `anthropic_workspace_costs` — Add plan association

| New Field | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| planConnectionId | integer | NOT NULL, FK → anthropic_plan_connections.id | Which plan this cost belongs to |

**Index changes**:
- Drop existing unique index on `(workspace_id, date) WHERE workspace_id IS NOT NULL`
- Add unique index on `(workspace_id, date, plan_connection_id) WHERE workspace_id IS NOT NULL`
- Drop existing unique index on `date WHERE workspace_id IS NULL`
- Add unique index on `(date, plan_connection_id) WHERE workspace_id IS NULL`

**Migration**: Backfill all existing rows with the auto-imported first plan connection's ID.

---

### `sync_events` — Add optional plan tracking

| New Field | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| planConnectionId | integer | nullable, FK → anthropic_plan_connections.id | Which plan this sync event was for (null = non-plan sync sources like GitHub) |

**No index changes** — existing indexes sufficient. The column is nullable because non-Anthropic sync sources don't have plans.

---

## Entity Relationship Summary

```
anthropic_plan_connections (1) ──→ (N) anthropic_usage_metrics
anthropic_plan_connections (1) ──→ (N) anthropic_workspaces
anthropic_plan_connections (1) ──→ (N) anthropic_workspace_costs
anthropic_plan_connections (1) ──→ (N) anthropic_sync_status
anthropic_plan_connections (1) ──→ (N) sync_events (nullable)
users (1) ──→ (N) anthropic_plan_connections (via createdBy)
```

## Migration Strategy

1. Create `anthropic_plan_connections` table with enum
2. Insert first plan row from `ANTHROPIC_ADMIN_API_KEY` env var (if set and table is empty)
3. Add `plan_connection_id` columns (nullable initially) to all modified tables
4. Backfill all existing rows with the first plan's ID
5. Set columns to NOT NULL
6. Drop old unique indexes, create new composite indexes
7. Add foreign key constraints

**Rollback**: Drop new columns, recreate original indexes. The `anthropic_plan_connections` table can remain without impact.

## Validation Rules

- **Label**: 1–200 characters, trimmed, non-empty
- **Admin API Key**: Non-empty string, encrypted before storage
- **Key uniqueness**: Validated by checking `adminApiKeyHint` against active connections before insert
- **Max connections**: Application-level check (≤ 10 active connections)
- **Status transitions**: Only `active` → `disconnected` allowed (enforced in server action)
