# Server Action Contracts: Global Claude Console Metrics & Budget Monitoring

**Feature**: 018-claude-global-metrics
**Date**: 2026-03-20

All actions return `ActionResult<T>` per the existing pattern:
```typescript
type ActionResult<T> = { success: true; data: T } | { success: false; error: string }
```

All actions require admin role unless noted. Non-admin callers receive `{ success: false, error: "Unauthorized" }` without further processing.

---

## `getGlobalCostDashboard` (`src/actions/anthropic-workspace-costs.ts`)

Returns org-wide daily cost breakdown for a given calendar month, aggregated from `anthropic_workspace_costs`. Intended for the global dashboard page.

```typescript
export async function getGlobalCostDashboard(
  month?: string  // "YYYY-MM" — defaults to current calendar month
): Promise<ActionResult<GlobalCostDashboardData>>

type DailyTotal = {
  date: string          // "YYYY-MM-DD"
  totalCostCents: number
}

type WorkspaceDailyBreakdown = {
  workspaceId: string | null  // null = default workspace
  name: string
  displayColor: string | null
  isArchived: boolean
  dailyCosts: Array<{
    date: string        // "YYYY-MM-DD"
    costCents: number
  }>
  monthTotalCents: number
}

type GlobalCostDashboardData = {
  month: string                              // "YYYY-MM" — echoes the resolved month
  dailyTotals: DailyTotal[]                  // one entry per day that has any cost data
  workspaceBreakdown: WorkspaceDailyBreakdown[]  // ordered by monthTotalCents DESC
  grandTotalCents: number                    // sum of all workspace costs in the month
  dataAvailable: boolean                     // false if no cost rows exist for this month
}
```

**Auth**: Admin only.

**Query behavior**:
- Joins `anthropic_workspace_costs` with `anthropic_workspaces` on `workspaceId` (NULL-safe: `costs.workspace_id IS NOT DISTINCT FROM workspaces.workspace_id`)
- Filters by `date >= YYYY-MM-01 AND date < YYYY-(MM+1)-01`
- Workspaces with no cost rows in the requested month are excluded from `workspaceBreakdown`
- Workspaces present in `anthropic_workspace_costs` but not in `anthropic_workspaces` are included with `name: "Unknown Workspace"`, `displayColor: null`, `isArchived: false`

**Cache/revalidation**:
- No `cache()` wrapper — called from a Server Component that is already revalidated on demand
- Revalidated by `syncAnthropicWorkspaces()` via `revalidateTag("anthropic-workspace-costs")`
- For the current month, data changes on each workspace sync; for past months, data is effectively immutable

**Validation**:
- `month` validated with `z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional()`
- Invalid `month` returns `{ success: false, error: "Invalid month format. Expected YYYY-MM." }`

---

## `getWorkspaceList` (`src/actions/anthropic-workspace-costs.ts`)

Returns all non-archived workspaces with their current month's cost total and configured spending limit. Intended for the workspace management table.

```typescript
export async function getWorkspaceList(): Promise<ActionResult<WorkspaceListData>>

type WorkspaceRow = {
  workspaceId: string | null   // null = default workspace
  name: string
  displayColor: string | null
  isArchived: boolean
  anthropicCreatedAt: string | null  // ISO timestamp
  currentMonthCostCents: number      // sum of costs in current calendar month, 0 if no data
  limitCents: number | null          // null if no limit configured
  limitPct: number | null            // currentMonthCostCents / limitCents * 100, null if no limit
  lastSyncAt: string | null          // workspaceSyncCompletedAt from anthropicSyncStatus userId=-1
}

type WorkspaceListData = {
  workspaces: WorkspaceRow[]         // ordered by name ASC, default workspace first
  totalCurrentMonthCostCents: number
  lastSyncAt: string | null
}
```

**Auth**: Admin only.

**Query behavior**:
- Three-way left join: `anthropic_workspaces` LEFT JOIN `anthropic_workspace_costs` (filtered to current month, aggregated) LEFT JOIN `anthropic_workspace_limits`
- Archived workspaces are excluded by default (`WHERE is_archived = false`)
- `limitPct` is computed in application code after the query, not in SQL, to avoid division-by-zero
- `lastSyncAt` is fetched from `anthropicSyncStatus WHERE userId = -1`

**Cache/revalidation**:
- No persistent cache — queried fresh on each page load
- Revalidated by `syncAnthropicWorkspaces()` and `setWorkspaceLimit()` via `revalidatePath("/admin/claude")`

---

## `setWorkspaceLimit` (`src/actions/anthropic-workspace-costs.ts`)

Upserts or removes the monthly spending limit for a workspace. Passing `null` as `limitCents` deletes the limit row.

```typescript
export async function setWorkspaceLimit(
  workspaceId: string | null,  // null = default workspace
  limitCents: number | null    // null to remove limit; positive integer to set/update
): Promise<ActionResult<{ workspaceId: string | null; limitCents: number | null }>>
```

**Auth**: Admin only.

**Behavior**:
1. Validate inputs (see below)
2. If `limitCents` is null: delete the row from `anthropic_workspace_limits` WHERE `workspace_id IS NOT DISTINCT FROM $workspaceId`. No-op if no row exists; returns success either way.
3. If `limitCents` is a positive integer: upsert — INSERT INTO `anthropic_workspace_limits` ... ON CONFLICT DO UPDATE SET `limit_cents = $limitCents, updated_at = now()`
4. Revalidate via `revalidatePath("/admin/claude")` and `revalidateTag("alerts")`
5. Return `{ success: true, data: { workspaceId, limitCents } }`

**Validation**:
- `workspaceId`: `z.string().max(100).nullable()` — the empty string is rejected
- `limitCents`: `z.number().int().positive().nullable()` — if non-null, must be a positive integer

**Errors**:
- `"Limit must be a positive integer"` — limitCents is 0 or negative
- `"workspaceId must be a non-empty string or null"` — empty string passed

**Cache/revalidation**: `revalidatePath("/admin/claude")` + `revalidateTag("alerts")` after every successful write.

---

## `getActiveAlerts` (`src/actions/anthropic-workspace-costs.ts`)

Checks whether any workspace is approaching or over its spending limit in the current calendar month. Used by the root admin layout to show a notification banner. Returns immediately with cached data.

```typescript
export async function getActiveAlerts(): Promise<ActionResult<ActiveAlertsData>>

type WorkspaceAlert = {
  workspaceId: string | null  // null = default workspace
  name: string
  costCents: number
  limitCents: number
  pct: number                 // costCents / limitCents * 100, rounded to 1 decimal
  severity: "warning" | "critical"  // warning = 80–99%, critical = 100%+
}

type ActiveAlertsData = {
  workspaceAlerts: WorkspaceAlert[]    // only workspaces at >= 80% of their limit
  creditsLow: boolean                  // always false — see getOrgCreditsStatus
  creditsCritical: boolean             // always false — see getOrgCreditsStatus
}
```

**Auth**: Admin only.

**Query behavior**:
- Joins `anthropic_workspace_limits` with `anthropic_workspace_costs` (current month aggregate, NULL-safe on workspaceId)
- Computes `pct = costCents / limitCents * 100` in application code
- Includes only rows where `pct >= 80`
- Orders by `pct DESC`
- `creditsLow` and `creditsCritical` are hardcoded to `false` because the Anthropic API does not expose credit balance data (see `getOrgCreditsStatus`)

**Cache/revalidation**:
- Wrapped with `unstable_cache` / tagged `"alerts"` with a 5-minute revalidation period:
  ```typescript
  const cached = unstable_cache(fetchAlerts, ["alerts"], {
    revalidate: 300,
    tags: ["alerts"],
  })
  ```
- Explicitly invalidated (tag `"alerts"`) by `setWorkspaceLimit()` and `syncAnthropicWorkspaces()`
- The 5-minute TTL means alert state may lag slightly behind real-time cost data, which is acceptable — the cost data itself only changes on workspace sync (not continuously)

---

## `syncAnthropicWorkspaces` (`src/actions/anthropic-workspace-sync.ts`)

Admin-triggered manual sync of the workspace list and workspace-level cost data from the Anthropic Admin API. Follows the same concurrency-guard pattern as the user usage sync.

```typescript
export async function syncAnthropicWorkspaces(): Promise<ActionResult<SyncWorkspacesResult>>

type SyncWorkspacesResult = {
  workspacesUpserted: number   // number of workspace rows created or updated
  costRowsUpserted: number     // number of daily cost rows created or updated
  daysBackfilled: number       // number of calendar days fetched in this sync run
  durationMs: number
}
```

**Auth**: Admin only.

**Behavior**:
1. Check concurrency guard: read `anthropicSyncStatus WHERE userId = -1`. If `lastSyncStartedAt` is within the last 60 seconds and `lastSyncCompletedAt < lastSyncStartedAt` → return `{ success: false, error: "Workspace sync already in progress" }`
2. If stale lock (started > 5 minutes ago with no completion) → proceed, treating prior lock as failed
3. Create or upsert the `userId = -1` sentinel row with `lastSyncStartedAt = now()`
4. Fetch workspace list: `GET /v1/organizations/workspaces` — upsert all returned workspaces into `anthropic_workspaces` (set `isArchived` based on `archived_at`, update `lastSeenAt`)
5. Ensure the default-workspace sentinel row exists in `anthropic_workspaces` (`workspaceId IS NULL`, `isDefault = true`)
6. Determine cost fetch range: use `MAX(date)` from `anthropic_workspace_costs` as the start (or 31 days back if no data)
7. Fetch cost report: `GET /v1/organizations/cost_report?group_by[]=workspace_id` for the determined date range
8. Upsert all returned cost rows into `anthropic_workspace_costs` (NULL-safe on workspaceId for default workspace)
9. Update sentinel row: `lastSyncCompletedAt = now()`, `workspaceSyncCompletedAt = now()`, `syncedDays = daysBackfilled`, clear `lastSyncError`
10. Revalidate: `revalidateTag("anthropic-workspace-costs")`, `revalidateTag("alerts")`, `revalidatePath("/admin/claude")`
11. Return result counts

**On failure** (any step after step 3):
- Set `lastSyncError` on the `userId = -1` sentinel row
- Leave `lastSyncCompletedAt` unchanged (so the stale-lock detector can identify a failed run)
- Return `{ success: false, error: "<message>" }`

**Errors**:
- `"Workspace sync already in progress"` — concurrency guard triggered
- `"Anthropic API error: <status> <body>"` — non-2xx response from the Anthropic Admin API
- `"No Anthropic Admin API key configured"` — `ANTHROPIC_ADMIN_API_KEY` env var not set

**Cache/revalidation**: Tags `"anthropic-workspace-costs"` and `"alerts"` are invalidated after a successful sync.

**Note**: This action is also called by the cron route `POST /api/anthropic/workspace-sync` (protected by `CRON_SECRET`). The cron route calls `syncAnthropicWorkspaces()` directly and returns its result as JSON.

---

## `getOrgCreditsStatus` (`src/actions/anthropic-workspace-costs.ts`)

Returns the credit balance status for the Anthropic organization. Always returns a "not available" sentinel because the Anthropic Admin API does not expose a credit balance or billing budget endpoint.

```typescript
export async function getOrgCreditsStatus(): Promise<ActionResult<OrgCreditsStatus>>

type OrgCreditsStatus =
  | { available: false; reason: "not_exposed_by_api" }
```

**Auth**: Admin only.

**Behavior**: Returns `{ success: true, data: { available: false, reason: "not_exposed_by_api" } }` unconditionally. No database or API calls are made. This action exists as a stable interface point: if Anthropic adds a credit balance endpoint in the future, only this action needs to change — callers remain unmodified.

**Cache/revalidation**: No caching needed — the response is always the same constant value.

**Notes**:
- `getActiveAlerts` hardcodes `creditsLow: false` and `creditsCritical: false` based on this limitation.
- The UI should display an informational note explaining that credit balance monitoring is not available rather than showing a broken or empty widget.

---

## API Route (`src/app/api/anthropic/workspace-sync/route.ts`)

### `POST /api/anthropic/workspace-sync`

Cron-triggered endpoint for automated workspace list + cost data syncing. Same pattern as `POST /api/anthropic/sync` (user usage sync) and `POST /api/copilot/sync`.

```typescript
// Request
Headers: { Authorization: "Bearer {CRON_SECRET}" }

// Response (200 on success or already-in-progress, 500 on unhandled error)
type SyncRouteResponse = {
  success: boolean
  data?: SyncWorkspacesResult
  error?: string
}
```

**Auth**: `CRON_SECRET` bearer token validation (not user session auth). Returns 401 if the token is missing or incorrect.

**Behavior**: Validates the `CRON_SECRET` header, then calls `syncAnthropicWorkspaces()` and returns its result as JSON. Does not throw — all errors are caught and returned as `{ success: false, error }` with HTTP 200 (so the cron service does not retry on application-level errors that would recur, only on network-level failures).
