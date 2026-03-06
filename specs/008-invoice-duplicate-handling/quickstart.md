# Quickstart: Invoice Duplicate Handling & Amount Display

**Feature**: 008-invoice-duplicate-handling
**Date**: 2026-03-06

## What This Feature Does

Improves the invoice upload experience in three ways:

1. **Duplicate detection** — Recognizes when an uploaded invoice has the same number as an existing one
2. **Single upload resolution** — Lets the admin skip or overwrite the existing invoice (and its budget link)
3. **Bulk upload skip** — Automatically flags duplicates in batch uploads so they're skipped on save
4. **Dollar display** — Shows extracted amounts in dollars ($125.00) instead of raw cents (12500)

## Files to Modify

### Server Actions (`src/actions/invoices.ts`)

- **Add** `checkInvoiceDuplicate(invoiceNumber)` — returns existing invoice details if found
- **Add** `checkBulkDuplicates(invoiceNumbers[])` — batch duplicate check for zip uploads
- **Add** `overwriteInvoice(existingId, newData)` — update-in-place with billed cost handling
- **Add** `cleanupBlob(blobPathname)` — internal helper for R2 deletion on skip
- **Modify** `saveInvoice()` — remove soft duplicate check (lines 102-106, 171)
- **Modify** `saveBulkInvoices()` — accept `skip` flag per item, clean up skipped blobs

### Single Upload Form (`src/app/invoices/new/invoice-upload-form.tsx`)

- **Add** duplicate check call after extraction/field edit
- **Add** duplicate resolution dialog (Skip / Overwrite)
- **Change** amount field: label "Amount ($)", input `step="0.01"`, placeholder "0.00"
- **Add** cents↔dollars conversion: divide by 100 on display, multiply by 100 on submit

### Bulk Upload Form (`src/app/invoices/bulk/bulk-upload-form.tsx`)

- **Add** `checkBulkDuplicates` call after extraction, before review screen
- **Add** visual duplicate flags on review table rows
- **Add** within-batch duplicate detection (client-side)
- **Add** skip logic: flagged rows excluded from save, blobs cleaned up
- **Change** amount column: display in dollars instead of cents
- **Modify** outcome summary: show saved / skipped (duplicate) / failed counts

### Validators (`src/lib/validators.ts`)

- No schema changes needed — `amountCents` stays as `z.number().int().positive()`
- Conversion between dollars and cents is a UI concern

### Database Schema (`src/lib/db/schema.ts`)

- No changes — `invoiceNumber` remains non-unique index

## Implementation Order

1. **Amount display** (P3 from spec, but simplest change — do first to reduce diff noise)
   - Update single upload form amount field
   - Update bulk review table amount column
   - Add cents↔dollars conversion logic

2. **Duplicate check actions** (foundation for P1 and P2)
   - Implement `checkInvoiceDuplicate`
   - Implement `checkBulkDuplicates`
   - Implement `cleanupBlob` helper

3. **Single upload duplicate flow** (P1)
   - Add duplicate check after extraction
   - Build duplicate resolution dialog
   - Implement `overwriteInvoice` action
   - Handle skip (blob cleanup + form reset)

4. **Bulk upload duplicate flow** (P2)
   - Integrate `checkBulkDuplicates` into zip upload flow
   - Add within-batch duplicate detection
   - Add visual flags to review table
   - Modify `saveBulkInvoices` to skip flagged items
   - Update outcome summary display

## Key Patterns to Follow

- **Server action return type**: `{ success: true, data } | { success: false, error }` (existing pattern)
- **R2 cleanup**: Best-effort `DeleteObjectCommand` in try/catch (see `src/actions/invoices.ts:124-129`)
- **Dollar input**: `type="number" step="0.01" min="0.01"` with `Math.round(parseFloat(v) * 100)` (see `src/app/budget/[id]/budget-detail-client.tsx:549-562`)
- **Currency display**: Use `formatCurrency()` from `src/lib/utils.ts`
- **Audit trail**: Call `recordCreation` for new billed costs (existing pattern)
