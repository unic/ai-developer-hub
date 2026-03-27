# Server Action Contracts: Ingestion Filters

**Branch**: `024-ingestion-filter` | **Date**: 2026-03-27

## Filter CRUD Actions

All actions are admin-only (guarded by `requireAdmin()`).

### `getIngestionFilters()`

Returns all filter rules ordered by priority.

**Input**: None
**Output**:
```typescript
ActionResult<IngestionFilterRow[]>

type IngestionFilterRow = {
  id: number;
  name: string;
  field: "vendor" | "invoice_number";
  mode: "whitelist" | "blacklist";
  value: VendorFilterValue | InvoiceNumberFilterValue;
  enabled: boolean;
  priority: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};
```

### `createIngestionFilter(input: unknown)`

Creates a new filter rule.

**Input** (validated via Zod):
```typescript
{
  name: string;              // 1-255 chars
  field: "vendor" | "invoice_number";
  mode: "whitelist" | "blacklist";
  value: VendorFilterValue | InvoiceNumberFilterValue;
  enabled?: boolean;         // default true
  priority?: number;         // default 0
}
```

**Output**: `ActionResult<{ id: number }>`
**Side effects**: `revalidatePath("/settings/ingestion")`

### `updateIngestionFilter(input: unknown)`

Partially updates an existing filter rule.

**Input** (validated via Zod):
```typescript
{
  id: number;
  name?: string;
  mode?: "whitelist" | "blacklist";
  value?: VendorFilterValue | InvoiceNumberFilterValue;
  enabled?: boolean;
  priority?: number;
}
```

**Output**: `ActionResult<{ id: number }>`
**Side effects**: `revalidatePath("/settings/ingestion")`

### `deleteIngestionFilter(id: number)`

Hard-deletes a filter rule. Previously filtered invoices remain unchanged.

**Input**: `{ id: number }`
**Output**: `ActionResult<void>`
**Side effects**: `revalidatePath("/settings/ingestion")`

### `toggleIngestionFilter(id: number)`

Flips the `enabled` boolean of a filter rule.

**Input**: `{ id: number }`
**Output**: `ActionResult<{ id: number; enabled: boolean }>`
**Side effects**: `revalidatePath("/settings/ingestion")`

## Filter Evaluation Interface

### `evaluateIngestionFilters(invoice)`

Pure evaluation function (not a server action). Called internally by ingest route and `saveInvoice`.

**Input**:
```typescript
{
  vendor: string | null;
  invoiceNumber: string;
}
```

**Output**:
```typescript
{
  filteredOut: boolean;
  matchedRule: { id: number; name: string; field: string; mode: string } | null;
  reason: string | null;  // e.g., "Blocked by blacklist rule 'Block Acme Corp'"
}
```

## Value Type Definitions

```typescript
type VendorFilterValue = {
  values: string[];  // 1+ items, each 1-255 chars
};

type InvoiceNumberFilterValue = {
  pattern: string;  // 1-500 chars, valid RegExp
};
```

## Modified Action: `saveInvoice`

**Change**: After invoice DB insert and before budget period auto-link, calls `evaluateIngestionFilters()`. If filtered:
- Updates invoice with `filteredOut: true`
- Logs with outcome `"filtered"` and reason in errorMessage
- Skips `findActivePeriodForDate` + `insertBilledCostDirect`
- Returns success with `filterWarning` instead of `linkWarning`

**Extended return type**:
```typescript
type SaveInvoiceResult =
  | { success: true; data: { id: number }; linkedPeriodLabel?: string; linkWarning?: string; filterWarning?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };
```

## Modified API Route: `POST /api/invoices/ingest`

**Change**: After extraction and duplicate check, before budget period lookup, calls `evaluateIngestionFilters()`. If filtered:
- Still uploads to R2
- Creates invoice record with `filteredOut: true`
- Skips `findPeriodForDate` + `billedCosts` insert
- Logs with outcome `"filtered"`
- Returns 200 with `{ status: "filtered", reason: "..." }` instead of `"created"`
