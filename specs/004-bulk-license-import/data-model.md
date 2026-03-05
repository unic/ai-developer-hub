# Data Model: Bulk License Import, API Key Management & User Profile Extension

**Branch**: `004-bulk-license-import` | **Date**: 2026-03-05

## Schema Changes

### 1. New Enum: `user_profile`

**Type**: PostgreSQL enum
**Values**: `boost`, `maxed`, `indie`
**Purpose**: Constrains the user profile classification at the database level.

### 2. Modified Table: `users`

**New column**:

| Column    | Type          | Nullable | Default | Notes                                      |
|-----------|---------------|----------|---------|---------------------------------------------|
| `profile` | `user_profile`| Yes      | `NULL`  | Optional user classification (Boost/Maxed/Indie) |

**Existing columns**: No changes to any existing columns.

**Migration notes**:
- Add `userProfileEnum` to schema: `pgEnum("user_profile", ["boost", "maxed", "indie"])`
- Add `profile: userProfileEnum("profile")` column to `users` table (nullable, no default)
- No index needed — profile is not used for lookups, only display/filtering
- Existing users will have `profile = NULL` after migration

### 3. Existing Table: `license_assignments` — No Changes

The `license_assignments` table already has all required columns for bulk import:
- `userId` (resolved from email during import)
- `toolId` (resolved from tool name during import)
- `tierId` (resolved from tier name during import)
- `costAtAssignmentCents` (auto-populated from tier)
- `workspace` (from CSV)
- `apiKeyEncrypted` (from CSV, encrypted before storage)
- `assignedAt` (from CSV `assigned_at` column)
- `status` (defaults to `active`)

No schema changes needed for the license assignments table.

### 4. Existing Tables: `ai_tools`, `access_tiers` — No Changes

These tables are only read during import for name-to-ID resolution. No modifications.

## Entity Relationships

```text
users (1) ──── (N) license_assignments (N) ──── (1) ai_tools
                         │
                         └──── (1) access_tiers
```

No new relationships introduced. The bulk import resolves references by name:
- `email` → `users.email` → `users.id`
- `tool` → `ai_tools.name` → `ai_tools.id`
- `tier` → `access_tiers.name` (scoped to matched tool) → `access_tiers.id`

## Validation Rules

### Bulk Assignment Import Row

| Field         | Required | Format           | Validation                                                    |
|---------------|----------|------------------|---------------------------------------------------------------|
| `email`       | Yes      | Email string     | Must match existing active user                               |
| `tool`        | Yes      | String           | Must match existing active tool name (case-insensitive)       |
| `tier`        | Yes      | String           | Must match active tier name for matched tool (case-insensitive)|
| `workspace`   | Yes      | String (≤200)    | Non-empty                                                     |
| `api_key`     | No       | String (≤500)    | If present, encrypted before storage                          |
| `assigned_at` | Yes      | YYYY-MM-DD       | Must be valid date in YYYY-MM-DD format                       |

### Conflict Rule

A row is invalid if the resolved user already has an active `license_assignment` for the resolved tool (regardless of tier).

### User Profile Field

| Field     | Required | Values                       | Validation                              |
|-----------|----------|------------------------------|-----------------------------------------|
| `profile` | No       | `boost`, `maxed`, `indie`    | Case-insensitive match; NULL if omitted |

Applied in:
- User creation form (new dropdown)
- User edit form (existing detail page)
- Bulk user import CSV (optional `profile` column)

## State Transitions

No new state transitions. License assignments created via bulk import follow the same lifecycle as manually-created assignments:
- Created → `active`
- Revoked → `inactive` (via existing revoke flow)

The `profile` field has no state machine — it's a simple mutable classification.
