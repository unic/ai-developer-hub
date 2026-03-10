# Server Action Contracts: GitHub Copilot Integration

**Feature**: 013-github-copilot-integration
**Date**: 2026-03-09

All actions return `ActionResult<T>` per existing pattern.

## Copilot Connection Actions (`src/actions/copilot.ts`)

### `enableCopilotSync()`

Enables Copilot syncing on the active GitHub connection.

```typescript
Input: {} (no params — uses active connection)
Output: ActionResult<{ connectionId: number }>
```

**Behavior**:
1. Requires admin role
2. Fetches active GitHub connection
3. Decrypts token, validates Copilot scopes (`manage_billing:copilot`)
4. Sets `copilotSyncEnabled = true`
5. Triggers initial sync (async — returns immediately, sync runs in background)
6. Records history

**Errors**: "No active GitHub connection", "Token lacks Copilot permissions: missing scopes: [list]", "Copilot syncing already enabled"

### `disableCopilotSync()`

Disables Copilot syncing. Preserves all data.

```typescript
Input: {} (no params)
Output: ActionResult<void>
```

### `triggerCopilotSync()`

Triggers a manual Copilot data sync.

```typescript
Input: {} (no params)
Output: ActionResult<{ syncEventId: number }>
```

**Behavior**:
1. Checks mutual exclusion (no in-progress Copilot sync)
2. Creates sync event with `status: "in_progress"`, `syncType: "copilot"`
3. Runs sync pipeline: billing → seats → metrics (sequential)
4. Updates sync event with final status and counts
5. Revalidates Copilot pages

**Errors**: "Copilot syncing not enabled", "Sync already in progress"

### `getCopilotSyncStatus()`

Returns current Copilot sync status for the settings page.

```typescript
Input: {} (no params)
Output: ActionResult<{
  enabled: boolean
  lastSyncAt: string | null
  lastSyncStatus: "completed" | "partial" | "failed" | null
  nextScheduledSync: string | null
  dataRange: { earliest: string; latest: string } | null
  recordCounts: { metrics: number; billing: number; seats: number }
}>
```

## Copilot Data Query Actions (`src/actions/copilot-data.ts`)

### `getCopilotOverview(dateRange?)`

Returns overview dashboard data.

```typescript
Input: { since?: string; until?: string }  // ISO date strings
Output: ActionResult<{
  totalSeats: number
  activeSeats: number
  pendingSeats: number
  acceptanceRate: number  // percentage, 0-100
  totalSuggestions: number
  totalAcceptances: number
  totalLinesSuggested: number
  totalLinesAccepted: number
  totalActiveUsers: number
  trends: Array<{
    date: string
    suggestions: number
    acceptances: number
    activeUsers: number
    acceptanceRate: number
  }>
}>
```

### `getCopilotSeats(filters?)`

Returns paginated seat data for the seats table.

```typescript
Input: {
  search?: string
  status?: "active" | "inactive" | "pending"
  sortBy?: "lastActivity" | "assignedAt" | "name"
  sortOrder?: "asc" | "desc"
  page?: number
  pageSize?: number
}
Output: ActionResult<{
  seats: Array<{
    githubLogin: string
    githubId: number
    avatarUrl: string | null
    assignedAt: string
    lastActivityAt: string | null
    lastActivityEditor: string | null
    planType: "business" | "enterprise"
    status: "active" | "inactive" | "pending"
    matchedUserId: number | null  // null if unmatched
    matchedUserName: string | null
  }>
  total: number
  page: number
  pageSize: number
}>
```

### `getCopilotSeatDetail(githubId)`

Returns individual seat detail for the seat detail page.

```typescript
Input: { githubId: number }
Output: ActionResult<{
  githubLogin: string
  githubId: number
  avatarUrl: string | null
  assignedAt: string
  lastActivityAt: string | null
  lastActivityEditor: string | null
  planType: "business" | "enterprise"
  status: "active" | "inactive" | "pending"
  matchedUserId: number | null
  matchedUserName: string | null
  activityTimeline: Array<{  // from sync event history
    date: string
    lastActivityAt: string | null
    status: string
  }>
}>
```

### `getCopilotBilling(dateRange?)`

Returns billing dashboard data.

```typescript
Input: { since?: string; until?: string }
Output: ActionResult<{
  currentMonth: {
    totalCostCents: number
    activeSeats: number
    totalSeats: number
    costPerActiveUserCents: number
    planType: string
  }
  cumulativeCostCents: number
  trends: Array<{
    month: string
    totalCostCents: number
    totalSeats: number
    activeSeats: number
    costPerActiveUserCents: number
  }>
}>
```

### `getCopilotAnalytics(dateRange?)`

Returns analytics breakdown data.

```typescript
Input: { since?: string; until?: string }
Output: ActionResult<{
  byLanguage: Array<{
    language: string
    suggestions: number
    acceptances: number
    acceptanceRate: number
    linesSuggested: number
    linesAccepted: number
  }>
  byEditor: Array<{
    editor: string
    engagedUsers: number
    suggestions: number
    acceptances: number
  }>
  activityDistribution: {
    powerUsers: number     // active 20+ days in range
    regularUsers: number   // active 5-19 days
    occasionalUsers: number // active 1-4 days
    inactiveUsers: number  // no activity
  }
  utilizationTrend: Array<{
    date: string
    activeUsers: number
    totalSeats: number
    utilizationRate: number
  }>
}>
```

## Copilot Sync Pipeline (Internal — `src/lib/copilot-sync.ts`)

### `runCopilotSync(connectionId, syncEventId)`

Internal function called by `triggerCopilotSync` and the scheduled sync handler.

```typescript
Pipeline steps (sequential):
1. syncBillingData(connection) → { seatsProcessed, billingProcessed }
   - GET /orgs/{org}/copilot/billing → org settings + seat breakdown
   - Upsert AI Tool "GitHub Copilot" + access tiers
   - Update maxLicenses on tool
   - Upsert billing snapshot for current month
   - Create/update billedCosts if matching budget period exists

2. syncSeatAssignments(connection) → { seatsProcessed }
   - GET /orgs/{org}/copilot/billing/seats (paginated)
   - Match seats to users via githubProfiles.githubId
   - Upsert license assignments (source: "copilot-sync")
   - Revoke assignments for removed seats
   - Handle tier changes (upgrade/downgrade)

3. syncUsageMetrics(connection) → { metricsProcessed }
   - Determine date range: last synced date + 1 → today - 1
   - GET /orgs/{org}/copilot/metrics?since={date}
   - Upsert daily metric records (flatten nested structure)
   - Store language/editor breakdowns as JSONB

4. Update sync event with final counts and status
```

## API Route (`src/app/api/copilot/sync/route.ts`)

### `POST /api/copilot/sync`

Endpoint for scheduled (cron) sync triggers.

```typescript
Headers: { Authorization: "Bearer {CRON_SECRET}" }
Response: { success: boolean; syncEventId?: number; error?: string }
```

Protected by a shared secret (not user auth) for cron compatibility.
