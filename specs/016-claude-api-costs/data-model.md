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
| computedCostCents | integer | NOT NULL, DEFAULT 0 | Cost in USD cents computed at sync time from tokens × pricing. Provides stable historical costs. |
| pricingResolved | boolean | NOT NULL, DEFAULT true | False if the model was not found in the pricing table at sync time (fallback pricing used). |
| createdAt | timestamp | NOT NULL, DEFAULT now() | Row creation time |
| updatedAt | timestamp | NOT NULL, DEFAULT now() | Row last update time |

**Unique constraint**: (userId, date, model)

**Indexes**:
- `idx_usage_metrics_user_date` on (userId, date) — primary query pattern for profile page and historical reports
- `idx_usage_metrics_date` on (date) — enables date-range queries across all users (admin reporting)
- `idx_usage_metrics_unresolved` on (pricingResolved) WHERE pricingResolved = false — fast lookup of rows needing pricing updates

**Relationships**:
- `userId` → `users.id` (many-to-one, CASCADE on delete)

**Notes**:
- This is **permanent storage**, not a cache. Historical days are immutable; today's data is upserted (accumulating throughout the day).
- Costs are computed at sync time and stored in `computedCostCents`. This provides stable historical values. Token counts are also stored for transparency and potential recalculation.
- Token counts use `bigint` (not `integer`) to safely handle heavy API users. A single day of aggressive long-context usage can produce hundreds of millions of tokens, exceeding 32-bit integer limits. In Drizzle, use `bigint('column', { mode: 'number' })` since values stay within JS safe integer range for daily per-model granularity.
- The `model` field stores the exact model identifier returned by the Anthropic API (e.g., "claude-opus-4-6", "claude-sonnet-4-6").

### Sync Behavior

Follows the incremental sync pattern established by `copilot_usage_metrics`:

1. **Fetch all org usage**: Single API call with `group_by[]=model&group_by[]=api_key_id&bucket_width=1d` — no per-user filtering
2. **Resolve api_key_id mappings**: Build a map of api_key_id → userId from `anthropic_sync_status.resolvedApiKeyId` (resolve any unmapped keys first via the org API keys listing)
3. **Map and upsert**: For each result row, look up the userId from the api_key_id map and upsert into `anthropic_usage_metrics`
4. **Unmatched keys**: Usage from api_key_ids that don't map to any user is silently skipped (could be API keys not managed in this system)
5. **Incremental range**: Use the oldest `MAX(date)` across all users as the starting point, or 31 days back if no data exists

**Backfill**: On first sync (no data for any user), fetch up to 31 days back (max per Anthropic API query). For longer backfill, chain multiple 31-day queries paginating backwards.

**Sync trigger**: Automated via a cron job calling `POST /api/anthropic/sync` (same pattern as Copilot sync at `POST /api/copilot/sync`). This is a single-pass global sync — one API call retrieves usage for the entire org, then results are mapped to individual users. Admin can also trigger manually from the UI. Users have no sync controls — they see whatever data the last cron run produced.

### Pricing Lookup (Application Code)

Not a database table — defined as a TypeScript constant map. Maps model prefixes to per-token pricing in USD.

```typescript
type ModelPricing = {
  prefix: string;              // Model identifier prefix for matching
  inputPerMToken: number;      // USD per million input tokens
  outputPerMToken: number;     // USD per million output tokens
  cacheReadPerMToken: number;  // USD per million cache-read tokens
  cacheWritePerMToken: number; // USD per million cache-creation tokens
};

// Ordered by prefix length (longest first) for greedy matching
const MODEL_PRICING: ModelPricing[] = [
  { prefix: "claude-opus-4", inputPerMToken: 15, outputPerMToken: 75, cacheReadPerMToken: 1.5, cacheWritePerMToken: 18.75 },
  { prefix: "claude-sonnet-4", inputPerMToken: 3, outputPerMToken: 15, cacheReadPerMToken: 0.3, cacheWritePerMToken: 3.75 },
  { prefix: "claude-haiku-4", inputPerMToken: 0.80, outputPerMToken: 4, cacheReadPerMToken: 0.08, cacheWritePerMToken: 1 },
];

function resolveModelPricing(model: string): { pricing: ModelPricing; resolved: boolean } {
  const match = MODEL_PRICING.find(p => model.startsWith(p.prefix));
  if (match) return { pricing: match, resolved: true };
  // Fallback: use highest pricing (conservative) and flag as unresolved
  return { pricing: MODEL_PRICING[0], resolved: false };
}
```

**Prefix matching rationale**: Anthropic model identifiers include version suffixes and date stamps (e.g., `claude-opus-4-6`, `claude-opus-4-6-20260301`). Prefix matching handles minor version bumps without requiring code changes. The pricing table is ordered by prefix length (longest first) to ensure the most specific match wins.

**Cost storage at sync time**: `computedCostCents` is calculated and stored during sync. This provides:
- Stable historical costs (users see the same number consistently)
- Fast queries (no recomputation on every page load)
- Clear audit trail of what cost was shown

**Unresolved pricing detection**: When a model is not found in the pricing table:
1. `pricingResolved` is set to `false` on the row
2. Fallback pricing (highest tier) is used for `computedCostCents`
3. An admin-visible indicator surfaces the count of unresolved rows
4. After updating the pricing table, an admin action (`recalculateUnresolvedCosts`) recomputes `computedCostCents` for all `pricingResolved = false` rows and sets them to `true`

### anthropic_sync_status

Tracks per-user sync metadata and cached API key mappings. One row per user. Also used for route-level concurrency guards on the global sync.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | serial | PK, auto-increment | Row identifier |
| userId | integer | FK → users.id, NOT NULL, UNIQUE | The user being synced |
| lastSyncStartedAt | timestamp | NULLABLE | When the last global sync started (written to all rows atomically as a lock signal) |
| lastSyncCompletedAt | timestamp | NULLABLE | When the last global sync completed successfully for this user |
| lastSyncError | varchar(500) | NULLABLE | Error message from last failed sync, if any |
| syncedDays | integer | NOT NULL, DEFAULT 0 | Number of days synced in last run |
| resolvedApiKeyId | varchar(100) | NULLABLE | The Anthropic-internal `api_key_id` resolved from the user's stored API key via the Admin API. Cached to avoid re-resolving on every sync. |

**Unique constraint**: (userId)

**Relationships**:
- `userId` → `users.id` (one-to-one, CASCADE on delete)

**API Key ID Resolution**: The Anthropic Admin API filters usage by `api_key_id` (an internal identifier), not by the API key string. To map a stored API key to its `api_key_id`:
1. Decrypt the user's `apiKeyEncrypted` from their `license_assignment`
2. Call `GET /v1/organizations/api_keys?status=active` to list all org API keys
3. Match the decrypted key against each entry's `partial_key_hint` field (suffix match)
4. Store the resolved `id` as `resolvedApiKeyId` in this table
5. On subsequent syncs, reuse `resolvedApiKeyId` without re-resolving (unless the key changes)

**Concurrency guard behavior** (global sync level):

Since the sync is now a single-pass global operation (not per-user), the concurrency guard operates at the route level:

1. Before starting the global sync, check if ANY `anthropic_sync_status` row has `lastSyncStartedAt` within the last 60 seconds AND `lastSyncCompletedAt` older than `lastSyncStartedAt` → a sync is already in progress, return early
2. If the most recent `lastSyncStartedAt` across all rows is older than 5 minutes with no corresponding completion → treat as stale/failed, allow a new sync
3. Set `lastSyncStartedAt = now()` on all user rows before calling the API (atomic update acts as a global lock)
4. After the sync completes, set `lastSyncCompletedAt = now()` on each user row that received data, or `lastSyncError` on rows where mapping/upsert failed
5. This prevents: overlapping global syncs from concurrent cron invocations, redundant API calls, and rate limit exhaustion

Per-user rows are retained for: `resolvedApiKeyId` caching, per-user `lastSyncCompletedAt` tracking (useful for admin visibility into which users have fresh data), and per-user error reporting.

## Modified Entities

No modifications to existing tables. The existing `license_assignments.apiKeyEncrypted` field is used as-is — the Anthropic `api_key_id` is resolved automatically at sync time and cached in `anthropic_sync_status.resolvedApiKeyId`.

## Entity Relationship Summary

```
users (existing)
  ├── 1:N → license_assignments (existing, unchanged — apiKeyEncrypted used for key resolution)
  ├── 1:N → anthropic_usage_metrics (NEW)
  └── 1:1 → anthropic_sync_status (NEW, includes cached resolvedApiKeyId)

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

### Sync Triggers

- **Cron job**: External cron service calls `POST /api/anthropic/sync` (protected by `CRON_SECRET`). Fetches all org usage in one pass (1–2 API calls) regardless of user count, then maps results to users via cached api_key_id mappings. Same pattern as `POST /api/copilot/sync`.
- **Admin manual sync**: Admin can trigger a sync for a specific user from the admin user detail page via a server action.

## Data Volume Estimates

- Per user per month: ~31 days × ~3 models = ~93 rows
- For 100 users: ~9,300 rows/month
- Annual (100 users): ~112,000 rows
- 5-year projection (100 users): ~560,000 rows — well within PostgreSQL comfort zone without partitioning
- Query pattern: Filter by userId + date range → always hits the composite index
- Historical queries (e.g., "last 12 months"): ~1,116 rows per user — trivial
