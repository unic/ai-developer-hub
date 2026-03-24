# API Contracts: Invoice Automations & Running Cost Visibility

**Feature**: 019-invoice-automations
**Date**: 2026-03-20 (updated 2026-03-24)

---

## 1. External Invoice Ingestion Endpoint

### `POST /api/invoices/ingest`

Accepts a PDF invoice submission from an external automation (e.g., email forwarding rule, script). Applies the same extraction, deduplication, and period-linking pipeline as the manual upload UI.

#### Authentication

```
Authorization: Bearer {INVOICE_INGEST_SECRET}
```

`INVOICE_INGEST_SECRET` is a deployment secret (environment variable). Unauthenticated or incorrectly authenticated requests receive `401 Unauthorized`.

#### Request

**Content-Type**: `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `invoice` | File (PDF) | Yes | The invoice PDF file. Max 10 MB. |
| `vendor` | string | No | Hint to aid extraction (e.g., `"anthropic_team"`). Optional. |

#### Responses

**200 OK** — Invoice processed successfully

```json
{
  "success": true,
  "data": {
    "invoiceId": 42,
    "invoiceNumber": "ANT-2026-03-001",
    "invoiceDate": "2026-03-01",
    "amountCents": 150000,
    "vendor": "Anthropic",
    "action": "created",
    "linkedPeriodId": 7,
    "linkedPeriodLabel": "March 2026"
  }
}
```

`action` values:
- `"created"` — new invoice created and linked to a period
- `"created_unlinked"` — created but no matching period found; held for reconciliation

**409 Conflict** — Invoice already exists (duplicate detection by invoice number)

```json
{
  "success": false,
  "error": "Invoice ANT-2026-03-001 already exists",
  "data": {
    "existingInvoiceId": 38
  }
}
```

**400 Bad Request** — Missing or invalid file

```json
{
  "success": false,
  "error": "No PDF file provided or file exceeds 10 MB limit"
}
```

**401 Unauthorized** — Missing or invalid Bearer token

```json
{
  "success": false,
  "error": "Unauthorized"
}
```

**422 Unprocessable Entity** — PDF could not be parsed

```json
{
  "success": false,
  "error": "Could not extract required fields from the provided PDF"
}
```

**500 Internal Server Error**

```json
{
  "success": false,
  "error": "An unexpected error occurred. Please try again."
}
```

---

## 2. Sync Trigger (Admin UI — Server Actions)

The sync dashboard triggers syncs via Next.js Server Actions (not REST endpoints). The contracts below document the Server Action signatures consumed by the UI.

### `triggerSync(sourceType: SyncSourceType): Promise<SyncActionResult>`

Manually triggers a regular sync for a registered source. Requires admin session.

```typescript
type SyncSourceType =
  | 'github_copilot_billing'
  | 'anthropic_api_usage'
  | 'anthropic_team_invoices'
  | 'github_members'
  | 'invoice_period_matching'
  | 'anthropic_api_costs';

type SyncActionResult =
  | { success: true; eventId: number }
  | { success: false; error: string };
```

**Error cases**:
- `"Sync already in progress for this source"` — advisory lock not acquired
- `"Source not found or disabled"` — source_type not in registry or `enabled = false`
- `"Unauthorized"` — caller is not admin

### `triggerBackfill(sourceType: SyncSourceType, startDate: string): Promise<SyncActionResult>`

Initiates a backfill for an API-driven source. `startDate` is an ISO 8601 date string (YYYY-MM-DD). Only valid for `github_copilot_billing`, `anthropic_api_usage`, and `anthropic_workspace_sync` (supports date-range queries via `cost_report` API's `starting_at`/`ending_at` parameters).

```typescript
// startDate: ISO date string, e.g., "2026-01-01"
// Returns same SyncActionResult shape as triggerSync
```

**Additional error cases**:
- `"Backfill not supported for this source"` — source is not API-driven
- `"Start date cannot be in the future"`
- `"Start date cannot be more than 24 months ago"`

### `getSyncStatus(): Promise<SyncStatusResult>`

Fetches the current status of all registered sync sources for the dashboard. Used by both the scheduled and manual jobs tables.

```typescript
type SyncSourceStatus = {
  sourceType: SyncSourceType;
  enabled: boolean;
  cronSchedule: string | null;
  lastEvent: {
    id: number;
    operationType: 'regular' | 'backfill';
    outcome: 'in_progress' | 'success' | 'partial' | 'failed';
    startedAt: string;           // ISO datetime
    completedAt: string | null;  // ISO datetime
    createdCount: number;
    updatedCount: number;
    skippedCount: number;
    errorCount: number;
    errorMessage: string | null;
  } | null;  // null = never synced
};

type SyncStatusResult =
  | { success: true; data: SyncSourceStatus[] }
  | { success: false; error: string };
```

### `getSyncHistory(options): Promise<SyncHistoryResult>`

Fetches sync event history filtered by trigger type. Used by the split tables on the sync dashboard.

```typescript
type SyncHistoryOptions = {
  triggerType: 'scheduled' | 'manual';  // scheduled = triggeredBy IS NULL, manual = triggeredBy IS NOT NULL
  limit?: number;                        // default 50
  sourceType?: SyncSourceType;           // optional filter by source
};

type SyncHistoryResult =
  | { success: true; data: SyncEventRow[] }
  | { success: false; error: string };

type SyncEventRow = {
  id: number;
  sourceType: SyncSourceType;
  operationType: 'regular' | 'backfill';
  outcome: 'in_progress' | 'success' | 'partial' | 'failed';
  startedAt: string;
  completedAt: string | null;
  triggeredBy: { id: number; name: string } | null;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  errorMessage: string | null;
};
```

### `checkAnthropicStatus(): Promise<AnthropicStatusResult>`

Checks Anthropic API connectivity for the Integrations page status card.

```typescript
type AnthropicStatusResult =
  | { success: true; data: { connected: boolean; workspaceName: string | null; lastCheckedAt: string } }
  | { success: false; error: string };
```

**Behaviour**:
- If `ANTHROPIC_ADMIN_API_KEY` is not set → `{ connected: false, workspaceName: null }`
- If set, makes a lightweight API call (`GET /v1/organizations/workspaces?limit=1`) to verify connectivity
- Returns default workspace name from `anthropic_workspaces` table (where `is_default = true`)

---

## 3. Cron Handler Routes

These routes are invoked by Vercel Cron and MUST NOT be called directly without `CRON_SECRET`. They are not part of the public API.

### `GET /api/sync/github-copilot`

Runs the GitHub Copilot billing sync.

**Auth**: `Authorization: Bearer {CRON_SECRET}` (validated by `requireCronSecret()`)

**Response** (always 200 to prevent Vercel retry escalation):
```json
{ "ok": true, "eventId": 123 }
// or
{ "ok": false, "reason": "sync_in_progress" }
```

### `GET /api/sync/anthropic-usage`

Runs the Anthropic API usage sync.

**Auth**: Same as above.

**Response**: Same shape.

### `GET /api/sync/anthropic-api-costs`

Runs the Anthropic API costs sync (workspace metadata + daily cost aggregates). Renamed from `/api/sync/anthropic-workspace`.

**Auth**: `Authorization: Bearer {CRON_SECRET}`

**Response**:
```json
{ "ok": true, "workspacesUpserted": 3, "costRowsUpserted": 45 }
// or
{ "ok": false, "reason": "sync_in_progress" }
```

---

## 4. Anthropic API Status Endpoint

### `GET /api/anthropic/status`

Lightweight connectivity check for the Claude Code integration status card on the Integrations page.

**Auth**: Admin session (via `requireAdmin()`)

**Response**:
```json
{
  "connected": true,
  "workspaceName": "My Workspace",
  "lastCheckedAt": "2026-03-24T10:30:00Z"
}
```

---

## 5. Running Costs in Budget Period View

Running costs are **not served via a separate API endpoint**. They are computed server-side within the existing budget period Server Component using a direct DB aggregation query. The UI contract is:

### Budget Period Detail — Running Costs Section

Displayed when `runningCostCents > 0` for the period's date range.

```typescript
type PeriodRunningCosts = {
  runningCostCents: number;      // SUM(cost_cents) from anthropic_workspace_costs for period date range
  lastUpdatedAt: string | null;  // ISO datetime of MAX(updated_at) in anthropic_workspace_costs
  source: 'anthropic_workspace_costs';  // authoritative cost_report API data (from 018)
  workspaceBreakdown?: Array<{   // optional — only when multiple workspaces exist
    workspaceId: string | null;
    name: string;
    costCents: number;
  }>;
};
```

**Visual contract**:
- Running costs appear in a dedicated "Running Costs" section, visually distinct from the "Billed Costs" section.
- A badge or label must read "Running Costs" (not "Invoiced" or "Billed").
- A "last updated" timestamp appears inline: e.g., "as of Mar 20, 2026 14:30"; running cost total reflects the official cost_report data (as of the last workspace cost sync).
- Period totals show three values: Billed Total, Running Total, Combined Total.
- Zero-value running costs are omitted entirely (no row shown).

---

## 5. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CRON_SECRET` | Yes (existing) | Bearer token for Vercel Cron job authentication |
| `INVOICE_INGEST_SECRET` | Yes (new) | Bearer token for external invoice ingestion endpoint |
| `GITHUB_TOKEN` | Yes (existing) | GitHub PAT with `manage_billing:copilot` scope |
| `ANTHROPIC_ADMIN_API_KEY` | Yes (existing) | Anthropic Admin API key for usage data |

---

## 7. UI Contracts (Session 2026-03-24)

### Settings → Sync Status Page

**Two tables**:
1. **Scheduled Jobs** — Shows sync events where `triggeredBy IS NULL` (cron-triggered). Columns: Source, Schedule, Last Run, Status (badge), Created/Updated/Skipped, Error, Actions (Sync Now, Backfill).
2. **Manual Jobs** — Shows sync events where `triggeredBy IS NOT NULL`. Columns: Source, Triggered By, Run Time, Status (badge), Created/Updated/Skipped, Error.

**Error cell**: Truncated to ~50 chars with `truncate` class. Wrapped in Radix `Popover` — clicking reveals full error in scrollable container (`max-h-60`). Only rendered when `errorMessage` is non-null.

**Progress pattern**:
1. Click "Sync Now" → `toast.info('Starting {source} sync...')`
2. Server action fires → row shows `in_progress` badge + `Loader2` spinner
3. Client polls `getSyncStatus()` every 5s while any source is `in_progress`
4. On completion → `toast.success('{source} complete: {created} created, {updated} updated')` or `toast.error('{source} failed: {message}')`

**GitHub Members special case**: "Sync Now" opens Radix `Sheet` (side panel) containing the interactive preview workflow — 3 tabs (Matched / Unmatched GitHub / Unmatched System), manual matching via `UserSearchCombobox`, inline user creation via `InlineUserForm`, conflict detection. Sync only executes on explicit confirm.

**Invoice Period Matching special case**: "Sync Now" shows dropdown with "Sync Now" and "Preview Changes (Dry Run)" options. Dry run opens `SyncResultsDialog` with preview.

### Settings → Integrations Page

**GitHub section**: Connection card only — org name, avatar, status badge, "Update Token" and "Disconnect" buttons. No sync history, no sync triggers, no member sync preview.

**Claude Code section**: Read-only status card:
- Title: "Claude Code (Anthropic API)"
- Status badge: "Connected" (green) or "Not Configured" (amber)
- Workspace name (if available, from `anthropic_workspaces` where `is_default = true`)
- Last API connectivity check timestamp
- No action buttons

### Removed UI Elements

| Page | Removed Element |
|------|----------------|
| `/users` | `SyncAllButton` component |
| `/users/[id]` | Any sync trigger button (keep "Last synced" display) |
| `/copilot/billing` | `BillingSyncButton` + sync history table |
| `/invoices` | `SyncInvoicesButton` (dry-run migrated to sync dashboard) |
| `/settings/integrations` | `CopilotSyncSection`, `ClaudeSyncSection`, GitHub member sync preview, sync history |
