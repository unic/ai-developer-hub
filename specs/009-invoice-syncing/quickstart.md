# Quickstart: Invoice-to-Budget Period Sync

**Feature**: 009-invoice-syncing | **Date**: 2026-03-06

## What This Feature Does

Adds a "Sync Invoices" action to the invoice management page that scans all uploaded invoices, verifies or corrects their budget period links, and reports results. Supports dry run preview before committing changes.

## Files to Create

| File | Purpose |
|------|---------|
| `src/actions/invoice-sync.ts` | Server action: `syncInvoices({ dryRun })` — core sync engine |
| `src/app/invoices/sync-invoices-button.tsx` | Client component: sync trigger button with loading state |
| `src/app/invoices/sync-results-dialog.tsx` | Client component: modal displaying sync results summary and details |

## Files to Modify

| File | Change |
|------|--------|
| `src/app/invoices/page.tsx` | Add "Sync Invoices" button to page header actions |
| `src/lib/validators.ts` | Add Zod schemas for sync input/output types |
| `src/types/index.ts` | Add `SyncInvoiceOutcome` and `SyncResult` TypeScript types (if not inferred from Zod) |

## No Changes Required

- **Database schema**: No new tables or columns needed
- **Migrations**: None
- **API routes**: Sync uses server actions, not REST endpoints
- **R2/blob storage**: Sync does not touch PDFs
- **Invoice extraction**: Sync does not re-extract fields from PDFs

## Key Implementation Notes

1. **New `findPeriodForDate` function**: Similar to existing `findActivePeriodForDate` but queries all budgets (active + archived), ordering active first then by `createdAt DESC`.

2. **Bulk load pattern**: Load all invoices + all periods in 2 queries, match in-memory, then write only what changed.

3. **Billed cost format**: Must match existing format exactly:
   - `description`: `"Invoice {num}"` or `"Invoice {num} — {vendor}"`
   - `vendorReference`: invoice number

4. **Per-invoice transaction**: Each correction is atomic (delete old + insert new + update link), but invoices are independent of each other.

5. **Dry run**: Same code path, skip mutations. Return identical result shape.

## Development Steps

1. Add types and Zod schemas for sync result
2. Implement `findPeriodForDate` (all-budgets variant)
3. Implement `syncInvoices` server action with dry run support
4. Build sync results dialog component
5. Build sync button component
6. Wire button into invoice listing page header
7. Write unit tests for matching logic
8. Write integration tests for sync action
