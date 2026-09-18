# Data Model: Workspace-Based Claude Cost Attribution

**Feature**: 045-workspace-cost-attribution | **Date**: 2026-09-18

One migration (`0032`). Two new tables, three modified, one new enum. No destructive column drops — the existing `anthropic_usage_metrics` computation stays exactly as it is (FR-014).

## New enum

```sql
CREATE TYPE attribution_mode AS ENUM ('billed', 'apportioned', 'unattributed');
```

Also used as the per-figure method marker, with one extra value at the API boundary — `estimated`, for the current day. It is deliberately _not_ an enum value in the database: no stored row is ever `estimated`, because only complete days are stored.

## New table: `anthropic_workspace_cost_items`

Billed cost at line-item grain, from `cost_report` with `group_by[]=workspace_id&group_by[]=description`.

| Column                      | Type              | Notes                                                           |
| --------------------------- | ----------------- | --------------------------------------------------------------- |
| `id`                        | serial PK         |                                                                 |
| `workspace_id`              | varchar(100) NULL | `NULL` = default workspace, matching the existing convention    |
| `date`                      | date NOT NULL     | UTC bucket start                                                |
| `model`                     | varchar(100) NULL | `NULL` for non-token costs (web search, code execution)         |
| `cost_type`                 | varchar(40) NULL  | `tokens` \| `web_search` \| `code_execution` \| `session_usage` |
| `token_type`                | varchar(60) NULL  | e.g. `cache_creation.ephemeral_1h_input_tokens`                 |
| `context_window`            | varchar(20) NULL  | `0-200k` \| `200k-1M`                                           |
| `service_tier`              | varchar(20) NULL  | `standard` \| `batch`                                           |
| `cost_cents`                | integer NOT NULL  | `CHECK >= 0`                                                    |
| `created_at` / `updated_at` | timestamp         |                                                                 |

**Indexes**

- Unique on the full grain, using the partial-index pattern the existing cost table already uses for nullable `workspace_id`:
  - `(workspace_id, date, model, cost_type, token_type, context_window, service_tier) WHERE workspace_id IS NOT NULL`
  - `(date, model, cost_type, token_type, context_window, service_tier) WHERE workspace_id IS NULL`
  - `NULL`s inside the grain columns need `COALESCE(...,'')` in the index expression, or the unique index will not collide. Use a generated grain key column if the expression index proves awkward in Drizzle.
- `(date)` for month-range scans
- `(workspace_id, date)` for per-workspace reads

**Relationship to `anthropic_workspace_costs`**: the existing table is kept as the daily rollup and remains the read path for the org dashboard and cap alerting, so those surfaces need no change. It is now _derived_ — the sync writes line items, then upserts the rollup as their sum per workspace-day. This keeps the change additive for every existing consumer.

## New table: `anthropic_workspace_owners`

The workspace-to-user relationship, promoted from an implicit join on `anthropic_sync_status.resolved_workspace_id`.

| Column                      | Type                 | Notes                                                         |
| --------------------------- | -------------------- | ------------------------------------------------------------- |
| `id`                        | serial PK            |                                                               |
| `workspace_id`              | varchar(100) NULL    |                                                               |
| `user_id`                   | integer NOT NULL     | FK → `users.id`, `ON DELETE CASCADE`                          |
| `source`                    | varchar(20) NOT NULL | `resolved` (from key resolution) \| `manual` (admin override) |
| `created_at` / `updated_at` | timestamp            |                                                               |

**Indexes**: unique `(workspace_id, user_id)` with the same NULL-workspace partial-index split; `(user_id)`.

**Population**: seeded in the migration from existing `anthropic_sync_status` rows where `resolved_api_key_id IS NOT NULL`; thereafter maintained by `resolveAllMappings()`. A `manual` row always wins over a `resolved` row for the same workspace and is never overwritten by the sync.

**Attribution mode** is derived, not stored: count of owners for a workspace → 1 = `billed`, >1 = `apportioned`, 0 = `unattributed`. Deriving avoids a denormalised field going stale when an admin edits ownership (FR-010 requires corrections to take effect without a re-sync).

## Modified: `anthropic_workspaces`

| Column              | Type              | Notes                                                                    |
| ------------------- | ----------------- | ------------------------------------------------------------------------ |
| `deprecated_at`     | timestamp NULL    | NEW. Non-null ⇒ excluded from listings, cap aggregates, alerting         |
| `deprecated_reason` | varchar(200) NULL | NEW. e.g. "Pooled boost-\* workspace, superseded by per-user workspaces" |

`is_archived` is left alone: it mirrors Anthropic's own state and is overwritten on every workspace sync (D7).

## Modified: `anthropic_usage_metrics`

| Column                  | Type                    | Notes                                                                                                                                          |
| ----------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `attributed_cost_cents` | integer NULL            | NEW. The billed or apportioned figure for this user-day-model. `NULL` = not yet attributed (current day, or a period with no cost-report data) |
| `attribution_mode`      | `attribution_mode` NULL | NEW. How `attributed_cost_cents` was derived                                                                                                   |

`computed_cost_cents` and `pricing_resolved` are unchanged and keep their meaning — they remain the apportionment weights, the current-day estimate and the reconciliation input.

**Read rule** for any per-user cost: `COALESCE(attributed_cost_cents, computed_cost_cents)`, with the method reported as `attribution_mode` when present and `estimated` when it falls through. This makes the swap a one-line change in each of the six consuming query sites.

## Modified: `sync_events`

No schema change. Reconciliation findings are recorded using the existing warning path (`error_count` / `error_message` are already populated non-fatally by `anthropic-workspace.ts`). If message length proves limiting, prefer a follow-up rather than widening the column in this feature.

## Derived read model (no table)

**`AttributedDailyCost`** — what every consumer receives:

| Field         | Type                                       | Notes  |
| ------------- | ------------------------------------------ | ------ |
| `userId`      | number                                     |        |
| `date`        | string (`YYYY-MM-DD`)                      |        |
| `costCents`   | number                                     |        |
| `method`      | `"billed" \| "apportioned" \| "estimated"` | FR-006 |
| `workspaceId` | string \| null                             |        |

## Migration ordering

1. Create enum, then the two tables (owners table has an FK to `users`).
2. Add nullable columns to `anthropic_workspaces` and `anthropic_usage_metrics` — all nullable, no table rewrite, no default backfill.
3. Seed `anthropic_workspace_owners` from `anthropic_sync_status`.
4. Mark the 12 `boost-*` workspaces deprecated (data migration, by name pattern, with the ids recorded in the migration file rather than a `LIKE` that could catch a future workspace).

Every step is additive; a rollback is dropping the new objects and columns. No existing read path breaks at any point, which is what allows the read-path swap to ship incrementally (plan phases 4–5).

## Volume estimate

Current estate: ~20 active workspaces × ~30 days × ~4 models × ~5 token types ≈ 12k rows/month, plus the existing rollup. At that rate the line-item table is ~150k rows/year — no partitioning needed.
