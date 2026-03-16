# Data Model: Claude API Cost Tracking

**Feature**: 016-claude-api-costs
**Date**: 2026-03-16
**Updated**: 2026-03-16 (revised: persistent history instead of cache)

## New Entities

### anthropic_usage_metrics

Stores daily token usage data fetched from the Anthropic Admin API as a permanent historical record. One row per user per day per model. Follows the same pattern as `copilot_usage_metrics` — data is persisted indefinitely for long-term cost monitoring and trend analysis.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | serial | PK, auto-increment | Row identifier |
| userId | integer | FK → users.id, NOT NULL | The user whose usage this represents |
| date | date | NOT NULL | The calendar date of usage |
| model | varchar(100) | NOT NULL | Anthropic model identifier (e.g., "claude-opus-4-6") |
| uncachedInputTokens | bigint | NOT NULL, DEFAULT 0 | Non-cached input tokens consumed |
| cacheReadInputTokens | bigint | NOT NULL, DEFAULT 0 | Cache-read input tokens consumed |
| cacheCreationInputTokens | bigint | NOT NULL, DEFAULT 0 | Cache creation input tokens (all durations combined) |
| outputTokens | bigint | NOT NULL, DEFAULT 0 | Output tokens generated |
| createdAt | timestamp | NOT NULL, DEFAULT now() | Row creation time |
| updatedAt | timestamp | NOT NULL, DEFAULT now() | Row last update time |

**Unique constraint**: (userId, date, model)

**Indexes**:
- `idx_usage_metrics_user_date` on (userId, date) — primary query pattern for profile page and historical reports
- `idx_usage_metrics_date` on (date) — enables date-range queries across all users (admin reporting)

**Relationships**:
- `userId` → `users.id` (many-to-one, CASCADE on delete)

**Notes**:
- This is **permanent storage**, not a cache. Historical days are immutable; today's data is upserted (accumulating throughout the day).
- Costs are NOT stored — they are computed at read time from token counts using a pricing lookup. This ensures pricing updates apply retroactively.
- Token counts use `bigint` (not `integer`) to safely handle heavy API users. A single day of aggressive long-context usage can produce hundreds of millions of tokens, exceeding 32-bit integer limits. In Drizzle, use `bigint('column', { mode: 'number' })` since values stay within JS safe integer range for daily per-model granularity.
- The `model` field stores the exact model identifier returned by the Anthropic API (e.g., "claude-opus-4-6", "claude-sonnet-4-6").

### Sync Behavior

Follows the incremental sync pattern established by `copilot_usage_metrics`:

1. **Detect latest stored date**: Query `MAX(date)` for the user from `anthropic_usage_metrics`
2. **Fetch only new data**: Set `starting_at` to latest date + 1 day (or first of current month if no history)
3. **Upsert rows**: Use `onConflictDoUpdate` on the unique (userId, date, model) constraint
4. **Today's data**: Always re-fetched and upserted (still accumulating)
5. **Past days**: Immutable after the day is complete — upsert is a no-op for unchanged data

**Manual refresh**: User can trigger a refresh which re-fetches the current day. Past days are not re-fetched unless a backfill is explicitly triggered.

**Backfill**: On first sync for a user, fetch up to 31 days back (max per Anthropic API query). For longer backfill, chain multiple 31-day queries paginating backwards.

### Pricing Lookup (Application Code)

Not a database table — defined as a TypeScript constant map. Maps model identifiers to per-token pricing in USD.

```typescript
type ModelPricing = {
  inputPerMToken: number;      // USD per million input tokens
  outputPerMToken: number;     // USD per million output tokens
  cacheReadPerMToken: number;  // USD per million cache-read tokens
  cacheWritePerMToken: number; // USD per million cache-creation tokens
};

const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-6": { inputPerMToken: 15, outputPerMToken: 75, cacheReadPerMToken: 1.5, cacheWritePerMToken: 18.75 },
  "claude-sonnet-4-6": { inputPerMToken: 3, outputPerMToken: 15, cacheReadPerMToken: 0.3, cacheWritePerMToken: 3.75 },
  "claude-haiku-4-5": { inputPerMToken: 0.80, outputPerMToken: 4, cacheReadPerMToken: 0.08, cacheWritePerMToken: 1 },
  // Fallback for unknown models: use highest pricing (conservative)
};
```

### anthropic_sync_status

Tracks the last sync time per user to prevent concurrent syncs and enforce rate limiting. One row per user.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | serial | PK, auto-increment | Row identifier |
| userId | integer | FK → users.id, NOT NULL, UNIQUE | The user being synced |
| lastSyncStartedAt | timestamp | NULLABLE | When the last sync started (used as a lock signal) |
| lastSyncCompletedAt | timestamp | NULLABLE | When the last sync completed successfully |
| lastSyncError | varchar(500) | NULLABLE | Error message from last failed sync, if any |
| syncedDays | integer | NOT NULL, DEFAULT 0 | Number of days synced in last run |

**Unique constraint**: (userId)

**Relationships**:
- `userId` → `users.id` (one-to-one, CASCADE on delete)

**Concurrency guard behavior**:
1. Before starting a sync, check `lastSyncStartedAt`:
   - If `lastSyncStartedAt` is within the last 60 seconds AND `lastSyncCompletedAt` is older than `lastSyncStartedAt` → sync is in progress, skip
   - If `lastSyncStartedAt` is older than 5 minutes with no completion → treat as stale/failed, allow new sync
2. Set `lastSyncStartedAt = now()` before calling the API
3. Set `lastSyncCompletedAt = now()` after success, or `lastSyncError` after failure
4. This prevents: concurrent syncs per user, redundant API calls on rapid page load + refresh, and rate limit exhaustion across the org

## Modified Entities

### license_assignments (existing)

Add one new field to store the Anthropic API key ID used for usage filtering.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| anthropicApiKeyId | varchar(100) | NULLABLE | The Anthropic-internal API key ID, used to filter usage_report queries. Set by admin when configuring the assignment. |

**Migration notes**:
- Add column with `ALTER TABLE license_assignments ADD COLUMN anthropic_api_key_id varchar(100)` (nullable, no default)
- Only relevant for assignments where the tool is Claude/Anthropic
- Populated by admin when configuring a user's API key assignment

## Entity Relationship Summary

```
users (existing)
  ├── 1:N → license_assignments (existing, +anthropicApiKeyId)
  ├── 1:N → anthropic_usage_metrics (NEW)
  └── 1:1 → anthropic_sync_status (NEW)

license_assignments (existing)
  └── anthropicApiKeyId: used to query Anthropic API for this user's usage

anthropic_usage_metrics (NEW)
  └── userId → users.id

anthropic_sync_status (NEW)
  └── userId → users.id (unique, one-to-one)
```

## Data Lifecycle

### Usage Metric Lifecycle

```
[Empty] → [Initial Backfill] → [Daily Incremental Sync] → [Immutable History]
```

- **Empty**: No data exists for this user. First sync triggers a backfill (up to 31 days back).
- **Initial Backfill**: Historical data fetched in 31-day chunks via the Anthropic API.
- **Daily Incremental Sync**: Each sync detects the latest stored date and fetches only new days. Today's row is upserted (still accumulating).
- **Immutable History**: Past days are never modified after the day is complete. Data persists indefinitely for long-term trend analysis.

### Refresh Triggers

- **Manual**: User clicks "Refresh" on profile page → re-syncs current day only
- **Admin sync**: Admin can trigger a full sync for a user from the admin detail page
- **Future**: Scheduled sync via cron (out of scope for this feature, but the incremental pattern supports it)

## Data Volume Estimates

- Per user per month: ~31 days × ~3 models = ~93 rows
- For 100 users: ~9,300 rows/month
- Annual (100 users): ~112,000 rows
- 5-year projection (100 users): ~560,000 rows — well within PostgreSQL comfort zone without partitioning
- Query pattern: Filter by userId + date range → always hits the composite index
- Historical queries (e.g., "last 12 months"): ~1,116 rows per user — trivial
