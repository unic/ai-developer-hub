# Contract: Anthropic Admin API Integration

**Feature**: 016-claude-api-costs
**Date**: 2026-03-16

## External API: Anthropic API Key Listing

Used to resolve a stored API key string to its internal `api_key_id` for usage filtering.

### Request

```
GET https://api.anthropic.com/v1/organizations/api_keys?status=active&limit=100
```

**Headers**: Same as usage report (Admin API key + anthropic-version).

### Response

```json
{
  "data": [
    {
      "id": "apikey_01ABC...",
      "name": "Production Key",
      "partial_key_hint": "sk-ant-...xyzw",
      "status": "active",
      "workspace_id": null,
      "created_at": "2026-01-15T10:00:00Z",
      "created_by": { "id": "user_01...", "type": "user" },
      "type": "api_key"
    }
  ],
  "has_more": false
}
```

### Key Resolution Logic

```typescript
function resolveApiKeyId(decryptedKey: string, orgKeys: OrgApiKey[]): string | null {
  // Match by checking if the decrypted key ends with the hint's suffix
  const match = orgKeys.find(k => {
    const hint = k.partial_key_hint;
    const suffix = hint.replace(/^\.+/, ''); // Strip leading dots
    return decryptedKey.endsWith(suffix);
  });
  return match?.id ?? null;
}
```

## External API: Anthropic Usage Report

### Request

```
GET https://api.anthropic.com/v1/organizations/usage_report/messages
```

**Headers**:
```
x-api-key: {ANTHROPIC_ADMIN_API_KEY}
anthropic-version: 2023-06-01
```

**Query Parameters** (for our use case):
```
starting_at=2026-03-01T00:00:00Z    # First day of current month (RFC 3339)
ending_at=2026-03-17T00:00:00Z      # Current date + 1 day
bucket_width=1d                       # Daily granularity
group_by[]=model                      # Group by model
group_by[]=api_key_id                 # Group by API key (per-user filtering)
api_key_ids[]=<user_api_key_id>       # Filter to specific user's key
limit=31                              # Max days in a month
```

### Response

```json
{
  "data": [
    {
      "starting_at": "2026-03-01T00:00:00Z",
      "ending_at": "2026-03-02T00:00:00Z",
      "results": [
        {
          "model": "claude-opus-4-6",
          "api_key_id": "apikey_01ABC...",
          "uncached_input_tokens": 150000,
          "cache_read_input_tokens": 50000,
          "cache_creation": {
            "ephemeral_5m_input_tokens": 10000,
            "ephemeral_1h_input_tokens": 5000
          },
          "output_tokens": 75000
        }
      ]
    }
  ],
  "has_more": false,
  "next_page": null
}
```

### Error Responses

| Status | Meaning | Handling |
|--------|---------|----------|
| 401 | Invalid admin API key | Show "API configuration error — contact administrator" |
| 403 | Insufficient permissions | Show "API key lacks required permissions — contact administrator" |
| 429 | Rate limited | Retry after `retry-after` header value; serve cached data |
| 500 | Server error | Serve cached data with stale notice |

### Pagination

If `has_more` is true, pass `page=<next_page>` to fetch additional buckets. For monthly queries with daily buckets this should not exceed 1 page (max 31 buckets).

## Cron Route: POST /api/anthropic/sync

Triggers usage sync for all users with valid Anthropic API keys. Called by an external cron service. Follows the same pattern as `POST /api/copilot/sync`.

### Request

```
POST /api/anthropic/sync
Authorization: Bearer {CRON_SECRET}
```

### Behavior

1. Validate `CRON_SECRET` header (reject with 401 if invalid)
2. Query all users with an active `license_assignment` that has `apiKeyEncrypted` set for an Anthropic tool
3. For each user (sequentially to respect rate limits):
   a. Check `anthropic_sync_status` — skip if sync already in progress or recently completed
   b. Resolve `api_key_id` from cached `resolvedApiKeyId` or by listing org API keys
   c. Run incremental sync (`syncAnthropicUsage`)
4. Return JSON summary

### Response

```json
{
  "success": true,
  "syncedUsers": 42,
  "skippedUsers": 3,
  "errors": [
    { "userId": 7, "error": "API key not found in org" }
  ]
}
```

### Error Responses

| Status | Meaning |
|--------|---------|
| 401 | Missing or invalid `CRON_SECRET` |
| 500 | Unexpected error during sync orchestration |

## Internal Server Actions

### getProfileData(userId)

Returns all data needed for the profile page.

**Input**: `userId: number` (from session)

**Output**:
```typescript
type ProfileData = {
  user: {
    id: number;
    name: string;
    email: string;
    role: "admin" | "viewer";
    circle: string | null;
    profile: "boost" | "maxed" | "indie" | null;
  };
  assignments: Array<{
    id: number;
    toolName: string;
    tierName: string;
    assignedAt: Date;
    status: "active" | "inactive";
  }>;
  costData: {
    available: boolean;
    error?: string;
    monthlyTotalCents: number;
    dailyBreakdown: Array<{
      date: string;        // "2026-03-01"
      models: Array<{
        model: string;     // "claude-opus-4-6"
        costCents: number; // Computed from tokens × pricing
        inputTokens: number;
        outputTokens: number;
      }>;
      totalCents: number;
    }>;
    latestDataDate: string | null;  // Latest date with stored data
  };
};
```

### syncAnthropicUsage(userId)

Incrementally syncs usage data from the Anthropic API into `anthropic_usage_metrics`. Follows the `copilot_usage_metrics` incremental sync pattern.

**Input**: `userId: number`

**Output**: `ActionResult<{ syncedDays: number; latestDate: string }>`

**Trigger modes**:
- **Cron job**: Called by the `POST /api/anthropic/sync` route for each user with a valid API key. Runs sequentially across users to respect rate limits.
- **Admin manual**: Admin triggers sync for a specific user from the user detail page. Admin-only access enforced via `requireAdmin()`.

**Behavior**:
- **Resolve API key ID** (first sync or when cached ID is missing): Decrypts user's `apiKeyEncrypted` from `license_assignments`, calls `GET /v1/organizations/api_keys?status=active`, matches `partial_key_hint` to resolve `api_key_id`, caches it in `anthropic_sync_status.resolvedApiKeyId`
- Detects latest stored date for the user in `anthropic_usage_metrics`
- Fetches from (latest date + 1 day) to today via the Anthropic Admin API, filtered by `api_key_ids[]=<resolvedApiKeyId>`
- On first sync (no history): backfills up to 31 days (API max per query)
- Upserts all rows using `onConflictDoUpdate` on (userId, date, model)
- Today's data is always re-fetched (still accumulating)

**Constraints**:
- Requires user to have a stored API key (`apiKeyEncrypted`) in their license assignment for an Anthropic tool
- Uses `ANTHROPIC_ADMIN_API_KEY` environment variable for authentication
- **Concurrency guard**: Checks `anthropic_sync_status` before calling the API. If a sync is already in progress (started < 60s ago, not completed), returns existing data immediately. If last sync completed < 60s ago, skips API call and returns existing data.
- On start: sets `lastSyncStartedAt = now()`. On success: sets `lastSyncCompletedAt = now()`. On failure: sets `lastSyncError`.
- Stale lock recovery: if `lastSyncStartedAt` is > 5 minutes old with no completion, the lock is considered stale and a new sync is allowed.

### getUserCostData(userId, month?)

Returns cost data for a user for a given month (defaults to current month). Reads `computedCostCents` directly from `anthropic_usage_metrics` — no recomputation needed.

**Input**: `userId: number`, `month?: string` (format "YYYY-MM", defaults to current)

**Output**: Same `costData` shape as above, plus:
```typescript
{
  // ...existing costData fields...
  hasUnresolvedPricing: boolean; // True if any rows in the period have pricingResolved = false
}
```

**Callable by**: The user themselves (profile page) or admins (user detail page)

### recalculateUnresolvedCosts()

Admin-only action. Recalculates `computedCostCents` for all rows where `pricingResolved = false`, using the current pricing table. Sets `pricingResolved = true` for rows that now resolve.

**Input**: None (operates on all unresolved rows)

**Output**: `ActionResult<{ updatedRows: number; stillUnresolved: number }>`

**Callable by**: Admins only. Triggered after updating the pricing lookup table in code.
