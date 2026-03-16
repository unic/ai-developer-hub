# Data Model: Claude API Cost Tracking

**Feature**: 016-claude-api-costs
**Date**: 2026-03-16

## New Entities

### anthropic_usage_cache

Caches daily token usage data fetched from the Anthropic Admin API. One row per user per day per model.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | serial | PK, auto-increment | Row identifier |
| userId | integer | FK → users.id, NOT NULL | The user whose usage this represents |
| date | date | NOT NULL | The calendar date of usage |
| model | varchar(100) | NOT NULL | Anthropic model identifier (e.g., "claude-opus-4-6") |
| uncachedInputTokens | integer | NOT NULL, DEFAULT 0 | Non-cached input tokens consumed |
| cacheReadInputTokens | integer | NOT NULL, DEFAULT 0 | Cache-read input tokens consumed |
| cacheCreationInputTokens | integer | NOT NULL, DEFAULT 0 | Cache creation input tokens (all durations combined) |
| outputTokens | integer | NOT NULL, DEFAULT 0 | Output tokens generated |
| fetchedAt | timestamp | NOT NULL | When this data was last fetched from API |
| createdAt | timestamp | NOT NULL, DEFAULT now() | Row creation time |
| updatedAt | timestamp | NOT NULL, DEFAULT now() | Row last update time |

**Unique constraint**: (userId, date, model)

**Indexes**:
- `idx_usage_cache_user_date` on (userId, date) — primary query pattern for profile page
- `idx_usage_cache_fetched` on (fetchedAt) — cache invalidation queries

**Relationships**:
- `userId` → `users.id` (many-to-one, CASCADE on delete)

**Notes**:
- Costs are NOT stored — they are computed at read time from token counts using a pricing lookup. This ensures pricing updates apply retroactively.
- Token counts are integers (no fractional tokens).
- The `model` field stores the exact model identifier returned by the Anthropic API (e.g., "claude-opus-4-6", "claude-sonnet-4-6").

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
  └── 1:N → anthropic_usage_cache (NEW)

license_assignments (existing)
  └── anthropicApiKeyId: used to query Anthropic API for this user's usage

anthropic_usage_cache (NEW)
  └── userId → users.id
```

## State Transitions

### Cache Entry Lifecycle

```
[Empty] → [Fresh] → [Stale] → [Refreshed/Fresh]
```

- **Empty**: No cache entry exists for this user/date/model
- **Fresh**: `fetchedAt` is within the last 5 minutes
- **Stale**: `fetchedAt` is older than 5 minutes
- **Refreshed**: User triggered manual refresh, cache updated with new data

Cache entries are upserted (insert or update on conflict of unique constraint).

## Data Volume Estimates

- Per user per month: ~31 days × ~3 models = ~93 rows in anthropic_usage_cache
- For 100 users: ~9,300 rows/month
- Annual: ~112,000 rows — well within PostgreSQL comfort zone without partitioning
- Query pattern: Filter by userId + date range → always hits the composite index
