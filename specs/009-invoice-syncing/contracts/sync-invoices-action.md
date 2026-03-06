# Contract: syncInvoices Server Action

**Feature**: 009-invoice-syncing | **Type**: Server Action

## Action Signature

```
syncInvoices(options: { dryRun: boolean }): Promise<SyncResult>
```

## Authentication

Requires admin role via `requireAdmin()`. Returns `{ success: false, error: "Unauthorized" }` if not admin.

## Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| dryRun | boolean | yes | When true, compute changes without writing to DB |

## Output: Success

```typescript
{
  success: true,
  data: {
    totalProcessed: number,
    verified: number,
    newlyLinked: number,
    corrected: number,
    unresolvable: number,
    errors: number,
    items: Array<{
      invoiceId: number,
      invoiceNumber: string,
      invoiceDate: string,        // YYYY-MM-DD
      amountCents: number,
      vendor: string | null,
      outcome: "verified" | "newly_linked" | "corrected" | "unresolvable" | "error",
      previousPeriodLabel: string | null,
      newPeriodLabel: string | null,
      reason: string | null,      // only for unresolvable/error
    }>
  }
}
```

## Output: Error

```typescript
{
  success: false,
  error: string   // e.g., "Unauthorized", "Sync failed: ..."
}
```

## Behavior

1. Load all invoices with their current linked period (single query with left joins)
2. Load all budget periods with parent budget status (single query)
3. For each invoice, determine the correct period based on invoice date
4. Categorize each invoice:
   - **verified**: Already linked to the correct period
   - **newly_linked**: Was unlinked, matching period found (write billed cost + link)
   - **corrected**: Was linked to wrong period, correct period found (delete old + create new + update link)
   - **unresolvable**: No budget period covers the invoice date
   - **error**: DB mutation failed for this invoice
5. If `dryRun` is false, execute mutations per-invoice in individual transactions
6. Return aggregate counts and per-invoice details

## Side Effects (when dryRun = false)

- Creates `billed_costs` rows for newly linked invoices
- Deletes and recreates `billed_costs` rows for corrected invoices
- Updates `invoices.linkedBilledCostId` for newly linked and corrected invoices
- Updates `invoices.updatedAt` for modified invoices
- Records history entries via `recordCreation` / `recordUpdate`
- Calls `revalidatePath("/invoices")` after all mutations

## Idempotency

Running sync twice in succession without data changes between runs produces:
- All previously newly_linked/corrected invoices now report as **verified**
- Same unresolvable invoices remain unresolvable
- Zero mutations on second run
