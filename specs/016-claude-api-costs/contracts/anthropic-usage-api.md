# Contract: Anthropic Admin API Integration

**Feature**: 016-claude-api-costs
**Date**: 2026-03-16

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
    lastFetchedAt: Date | null;
  };
};
```

### refreshCostData(userId)

Fetches fresh data from Anthropic API and updates cache.

**Input**: `userId: number` (from session)

**Output**: `ActionResult<{ lastFetchedAt: Date }>`

**Constraints**:
- Minimum 5 minutes between refreshes per user
- Requires user to have a valid `anthropicApiKeyId` in their license assignment
- Uses `ANTHROPIC_ADMIN_API_KEY` environment variable for authentication

### getUserCostData(userId) — Admin variant

Same as cost section of `getProfileData` but callable by admins for any user.

**Input**: `userId: number` (from admin context)

**Output**: Same `costData` shape as above
