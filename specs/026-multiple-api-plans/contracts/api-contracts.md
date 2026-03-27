# API Contracts: Multiple Claude API Plan Connections

**Feature**: 026-multiple-api-plans
**Date**: 2026-03-27

## Server Actions (plan-connections.ts)

### `getPlanConnections()`

Returns all plan connections for the organization.

**Auth**: Admin only
**Input**: None
**Output**:
```typescript
{
  success: true,
  data: {
    id: number
    label: string
    adminApiKeyHint: string  // masked, e.g. "sk-a••••••••1234"
    status: "active" | "disconnected"
    createdAt: string        // ISO datetime
    disconnectedAt: string | null
  }[]
} | { success: false, error: string }
```

---

### `addPlanConnection(data)`

Adds a new plan connection.

**Auth**: Admin only
**Input**:
```typescript
{
  label: string       // 1-200 chars, trimmed
  adminApiKey: string // plaintext, will be encrypted
}
```
**Validation**:
- Label: non-empty, max 200 chars
- Admin API key: non-empty, must not match an existing active connection's hint
- Active connection count must be < 10
- API key validity check: call Anthropic `/v1/organizations/workspaces?limit=1` to verify

**Output**:
```typescript
{ success: true, data: { id: number, label: string } }
| { success: false, error: string }
```

---

### `updatePlanConnectionLabel(id, label)`

Updates a plan connection's label.

**Auth**: Admin only
**Input**:
```typescript
{
  id: number
  label: string  // 1-200 chars, trimmed
}
```
**Output**:
```typescript
{ success: true }
| { success: false, error: string }
```

---

### `disconnectPlanConnection(id)`

Soft-deletes a plan connection by setting status to 'disconnected'.

**Auth**: Admin only
**Input**: `{ id: number }`
**Validation**: Connection must exist and be active. Cannot disconnect if it's the only active connection.
**Output**:
```typescript
{ success: true }
| { success: false, error: string }
```

---

## Modified Server Actions

### `getUserCostData(userId, month?)` — anthropic-usage.ts

**Change**: Return type gains optional `planLabel` field on daily breakdown for admin callers.

**Extended output** (admin view only):
```typescript
CostData & {
  planLabel?: string  // populated when caller is admin, null for self-view
}
```

---

### `getGlobalCostDashboard(month, planConnectionId?)` — anthropic-usage.ts

**Change**: Accepts optional `planConnectionId` filter. When provided, returns data for that plan only. When omitted, aggregates across all active plans.

**Extended input**: `planConnectionId?: number`
**Extended output**: `workspaceBreakdown` entries gain `planLabel` field:
```typescript
{
  workspaceId: string | null
  name: string
  planLabel: string      // NEW
  planConnectionId: number // NEW
  totalCents: number
  dailyTotals: { date: string, costCents: number }[]
}
```

---

## Modified Sync Interfaces

### `withSyncLock(params, fn)` — framework.ts

**Extended params**:
```typescript
interface WithSyncLockParams {
  sourceType: SyncSourceType
  triggeredBy?: number
  operationType?: SyncOperationType
  backfillStartDate?: Date
  planConnectionId?: number  // NEW: included in advisory lock hash
}
```

---

### Sync source `run()` functions

Both `anthropic-usage.ts` and `anthropic-workspace.ts` `run()` functions gain:

**Extended options**:
```typescript
interface RunOptions {
  force?: boolean
  backfillStartDate?: Date
  planConnectionId?: number  // NEW: sync specific plan only
}
```

When `planConnectionId` is omitted, the runner iterates all active plans.

---

### `fetchOrgApiKeys(adminApiKey)` — anthropic-keys.ts

**Change**: Accept explicit `adminApiKey` parameter instead of reading from env var.

**Before**: `fetchOrgApiKeys(): Promise<OrgApiKey[]>` (reads `process.env.ANTHROPIC_ADMIN_API_KEY`)
**After**: `fetchOrgApiKeys(adminApiKey: string): Promise<OrgApiKey[]>`

Same change applies to:
- `fetchAnthropicUsage(adminApiKey, startingAt, endingAt, apiKeyIds?)`
- `fetchWorkspaces(adminApiKey)`
- `fetchCostReport(adminApiKey, startingAt, endingAt)`
- `checkAnthropicStatus(adminApiKey?)`  — optional for backward compat during auto-import
