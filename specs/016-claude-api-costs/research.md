# Research: Claude API Cost Tracking

**Feature**: 016-claude-api-costs
**Date**: 2026-03-16

## R1: Anthropic Billing API

**Decision**: Use the Anthropic Admin API `usage_report/messages` endpoint with daily bucketing and model grouping.

**Rationale**: The Admin API provides two relevant endpoints:
- `GET /v1/organizations/usage_report/messages` — returns token-level usage with flexible grouping (by model, api_key_id, etc.) and daily bucketing
- `GET /v1/organizations/cost_report` — returns USD cost data (daily only) but does NOT include Priority Tier costs

The usage_report/messages endpoint is preferred because it supports grouping by both `model` and `api_key_id`, allowing per-user filtering. Cost can be computed from token counts using known pricing.

**Alternatives considered**:
- `cost_report` endpoint: Simpler (returns USD directly) but excludes Priority Tier costs and cannot group by `api_key_id` for per-user filtering. Rejected due to incomplete data.
- Per-user API key authentication: Each user's key could theoretically query their own usage, but the usage/cost endpoints require Admin API keys (`sk-ant-admin...`), not standard API keys. Not viable.

**Key API details**:
- Authentication: `x-api-key: sk-ant-admin...` + `anthropic-version: 2023-06-01`
- Endpoint: `GET https://api.anthropic.com/v1/organizations/usage_report/messages`
- Parameters: `starting_at`, `ending_at` (RFC 3339), `bucket_width=1d`, `group_by[]=model&group_by[]=api_key_id`, `api_key_ids[]=<id>`
- Response: Array of daily buckets, each with `results[]` containing `model`, `api_key_id`, `uncached_input_tokens`, `cache_read_input_tokens`, `output_tokens`, plus cache creation breakdown
- Rate limit: ~1 request/minute sustained; data freshness ~5 minutes
- Max buckets: 31 for daily width

## R2: Per-User Cost Identification

**Decision**: Store each user's Anthropic `api_key_id` in the existing `license_assignments` table (new field) and use it to filter usage queries.

**Rationale**: The Anthropic Admin API groups usage by `api_key_id` (an internal Anthropic identifier for each API key). To fetch per-user costs, we need to know each user's `api_key_id`. This can be stored when the admin configures the user's API key, or resolved via an Admin API call to list organization API keys.

**Alternatives considered**:
- Store `api_key_id` in a separate mapping table: Adds unnecessary schema complexity. The existing `license_assignments` table already stores the encrypted API key and is the natural place for this metadata.
- Query all usage and filter client-side: Wastes bandwidth and exposes other users' data to the server action. Rejected for efficiency and security.

## R3: Admin API Key Storage

**Decision**: Store the organization's Anthropic Admin API key as an environment variable (`ANTHROPIC_ADMIN_API_KEY`).

**Rationale**: There is exactly one admin API key per organization. It is a deployment-level secret, not user-specific data. Environment variables are the established pattern for such secrets in this project (see `API_KEY_ENCRYPTION_SECRET`, `DATABASE_URL`, `NEXTAUTH_SECRET`).

**Alternatives considered**:
- Store in database (like `github_connections.tokenEncrypted`): More complex, requires a new table or connection entity. The GitHub pattern makes sense because multiple GitHub orgs can be connected; Anthropic has exactly one org admin key. YAGNI.
- Store in a settings table: Over-engineered for a single value. Environment variable is simpler and follows existing patterns.

## R4: Cost Computation Strategy (Revised)

**Decision**: Compute costs at sync time using a prefix-based pricing lookup. Store computed costs (`computedCostCents`) alongside token counts. Flag rows with unresolved pricing for admin attention.

**Rationale**: The usage_report/messages endpoint returns token counts, not costs. Costs must be computed by multiplying token counts by per-model pricing. Three key improvements over the naive approach:

1. **Prefix matching instead of exact string match**: Anthropic model identifiers include version suffixes and date stamps (e.g., `claude-opus-4-6-20260301`). Prefix matching (`claude-opus-4` matches any variant) handles new versions without code changes.

2. **Store computed costs at sync time**: Instead of computing on every page load, costs are stored in `computedCostCents` during sync. This provides stable historical numbers (users see consistent values), eliminates recomputation overhead, and makes it clear what cost was shown at any point.

3. **Unknown model detection**: When a model doesn't match any pricing prefix, the row is flagged `pricingResolved = false` and fallback pricing is used. An admin-visible indicator surfaces unresolved rows. After updating the pricing table, an admin action recalculates affected rows.

**Alternatives considered**:
- Use the `cost_report` endpoint instead: Returns USD directly but excludes Priority Tier and cannot filter by `api_key_id`. Rejected.
- Store pricing in database: Over-engineered. Pricing changes rarely and a code constant is simpler to maintain and deploy.
- Compute costs purely at read time (original design): Causes historical costs to silently change when pricing is updated. Users see different numbers on different days for the same data. Rejected for consistency.

## R5: Persistent Usage History (Revised from Cache)

**Decision**: Store usage data permanently in a `anthropic_usage_metrics` table with incremental sync, following the same pattern as `copilot_usage_metrics`. This is persistent history, not a cache.

**Rationale**: Long-term cost monitoring requires historical data to survive across months and years. A TTL-based cache would lose historical data. The Anthropic API has no documented data retention limit, but relying on API availability for historical queries is fragile. Storing data permanently enables trend analysis, month-over-month comparisons, and reporting without API dependency for past periods.

**Sync strategy** (mirrors `copilot_usage_metrics`):
- **Incremental**: Detect latest stored date per user, fetch only new days
- **Upsert**: Today's data is re-fetched and upserted (still accumulating). Past days are immutable.
- **Backfill**: First sync fetches up to 31 days back (API max per query). Longer backfill chains multiple requests.
- **Admin manual sync**: Admins can trigger a sync for any user from the admin detail page.

**Alternatives considered**:
- TTL-based cache (original design): Loses historical data. Cannot support month-over-month analysis or long-term trend monitoring. Rejected after requirement clarification.
- Fetch from API on demand for historical data: API max is 31 days per query. Fetching 12 months of history would require 12 sequential API calls on each page load. Rejected for performance and rate limit reasons.
- Redis/memory cache: Does not persist across deployments and cannot support historical queries. Rejected.

## R6: Profile Page Architecture

**Decision**: Create a new `/profile` route as a dedicated profile page, reusing read-only display components from the existing user detail page where applicable.

**Rationale**: The existing `/users/[id]` page is admin-only with editing capabilities baked into the component structure. Creating a separate `/profile` route allows clean separation of concerns: the profile page is self-service, read-only, and restricted to the authenticated user. Shared display components (user info card, assignments list) can be extracted and reused.

**Alternatives considered**:
- Reuse `/users/[id]` with conditional rendering: The existing page mixes read/write UI heavily (React Hook Form, edit dialogs, revoke buttons). Conditionally hiding all edit UI would require extensive prop drilling and risk leaking admin functionality. Rejected for maintainability.
- Use `/users/me` route: Semantically appealing but conflicts with the existing admin user management namespace. `/profile` is cleaner.

## R7: Navigation — "My Profile" Link

**Decision**: Add a "My Profile" link to the sidebar footer where user info already displays, implementing it as a dropdown menu on the user name/avatar area.

**Rationale**: The current sidebar footer already shows the authenticated user's name and role. Converting this into a clickable dropdown with "My Profile" and "Sign Out" options is the most natural location and follows common dashboard patterns. The header currently only contains the sidebar trigger and is intentionally minimal.

**Alternatives considered**:
- Add to header: The header is intentionally sparse (sidebar trigger only). Adding a user menu there would require restructuring the header layout. More invasive.
- Add as sidebar nav item: Profile is a user-level concern, not a navigation category. Placing it in the sidebar footer (user area) is semantically correct.

Note: The spec says "user avatar/menu dropdown in the header" but the existing layout uses a sidebar footer for user info. We'll implement the dropdown in the sidebar footer user area, which serves the same purpose (quick access to profile) within the existing design pattern.

## R8: Sync Concurrency Guard

**Decision**: Add an `anthropic_sync_status` table (one row per user) that tracks sync start/completion timestamps. Use this as a lightweight lock to prevent concurrent syncs and enforce rate limiting.

**Rationale**: The profile page triggers automatic background syncs on page load when data is stale. With 100 users loading profiles, concurrent server-side syncs could exhaust the Anthropic Admin API rate limit (~1 req/min sustained). Manual sync is admin-only, but the automatic sync on page load still requires concurrency guards to prevent redundant API calls.

**Guard behavior**:
1. Check `lastSyncStartedAt`: if within 60s and no completion → sync in progress, skip
2. Check `lastSyncCompletedAt`: if within 60s → recently synced, skip
3. Stale lock recovery: if started > 5 minutes ago with no completion → allow new sync
4. On start: set `lastSyncStartedAt = now()`. On success: set `lastSyncCompletedAt = now()`.

**Alternatives considered**:
- Database advisory locks (`pg_try_advisory_lock`): More elegant but Neon serverless may not support long-held advisory locks across connection pool resets. Rejected for reliability.
- In-memory lock (Node.js): Does not survive serverless cold starts and doesn't work across multiple instances. Rejected.
- No guard (rely on upsert idempotency): Data would be correct but redundant API calls waste the shared org rate limit. Rejected.
