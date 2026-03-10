# Server Action Contracts: GitHub Billing Sync

**Feature**: 015-github-billing | **Date**: 2026-03-10

## Modified Actions

### `triggerCopilotSync()` — Extended

**File**: `src/actions/copilot.ts`
**Change**: After sync completes, the result now includes billing linking metrics.

```typescript
// No signature change — internal behavior extended
export async function triggerCopilotSync(): Promise<ActionResult<void>>
```

The underlying `runCopilotSync()` now calls the billing-to-budget linking step as part of `syncBillingData()`.

### `getCopilotSyncStatus()` — Extended Response

**File**: `src/actions/copilot.ts`
**Change**: Response includes billing linking counts.

```typescript
interface CopilotSyncStatus {
  // ... existing fields unchanged ...
  enabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: "completed" | "partial" | "failed" | null;
  nextScheduledSync: null;
  dataRange: { earliest: string; latest: string } | null;
  recordCounts: {
    metrics: number;
    billing: number;
    seats: number;
    linkedBillingMonths: number;   // NEW: count of snapshots with linked billed costs
  };
}
```

### `getCopilotBillingData()` — Extended Response

**File**: `src/actions/copilot-data.ts`
**Change**: Each billing row now includes budget period context.

```typescript
interface CopilotBillingRow {
  // ... existing fields ...
  billingMonth: string;
  planType: string;
  totalSeats: number;
  activeSeats: number;
  seatCostCents: number;
  totalCostCents: number;
  // NEW fields
  linkedBilledCostId: number | null;
  linkedPeriodLabel: string | null;
  linkedPeriodUtilization: number | null;  // percentage 0-100
  linkStatus: "linked" | "unlinked" | "conflict";
}
```

## New Actions

### `syncBillingToBudget()` — Billing-to-Budget Linking

**File**: `src/lib/copilot-sync.ts` (internal function, not a server action)
**Called by**: `syncBillingData()` after snapshot upsert

```typescript
interface BillingLinkResult {
  linked: number;     // billed costs created or updated
  skipped: number;    // months skipped (no period or conflict)
  conflicts: Array<{
    billingMonth: string;
    reason: "manual_entry_exists" | "no_matching_period";
    existingDescription?: string;
  }>;
}

async function syncBillingToBudget(
  connectionId: number,
  adminUserId: number
): Promise<BillingLinkResult>
```

**Behavior**:
1. Fetch all `copilotBillingSnapshots` for connection (up to 12 months)
2. For each snapshot:
   a. Find matching budget period via `findActivePeriodForDate(billingMonth)`
   b. If no period: skip, record "no_matching_period"
   c. Check for existing `billedCosts` with `vendorReference = 'github-billing-copilot-YYYY-MM'`
   d. If found: UPDATE amount and description
   e. If not found: check for manual conflicts in same period/month
   f. If manual conflict: skip, record "manual_entry_exists"
   g. If clean: INSERT new billed cost, link snapshot
3. Return counts and conflict details

### `getBillingSyncConflicts()` — Conflict Visibility

**File**: `src/actions/copilot-data.ts`

```typescript
interface BillingSyncConflict {
  billingMonth: string;
  snapshotAmountCents: number;
  manualEntryAmountCents: number;
  manualEntryDescription: string;
  periodLabel: string;
}

export async function getBillingSyncConflicts(): Promise<
  ActionResult<BillingSyncConflict[]>
>
```

**Behavior**: Returns all billing months where a Copilot snapshot exists but a manual billed cost entry prevents auto-linking. Displayed on the Copilot billing dashboard as conflict indicators.

## Shared Utility

### `findActivePeriodForDate()` — Extracted

**File**: `src/lib/budget-utils.ts` (NEW — extracted from `src/actions/invoices.ts`)

```typescript
export async function findActivePeriodForDate(
  invoiceDate: string
): Promise<{ id: number; periodLabel: string } | null>
```

**Change**: Extract existing function from `invoices.ts` to a shared utility so both invoice auto-linking and billing sync can use it. The `invoices.ts` file imports from the new location.
