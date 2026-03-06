# Research: Invoice Duplicate Handling & Amount Display

**Feature**: 008-invoice-duplicate-handling
**Date**: 2026-03-06

## R1: Current Duplicate Detection Mechanism

**Decision**: Enhance the existing soft duplicate check into a blocking check with user-driven resolution (skip/overwrite).

**Rationale**: The current implementation (`src/actions/invoices.ts:102-106`) performs a `findFirst` query on `invoiceNumber` but proceeds to insert regardless, returning only a warning string. This means duplicates are silently created with a toast notification the admin can miss. The invoice table has no unique constraint on `invoiceNumber` — only a non-unique index (`src/lib/db/schema.ts:276`). Adding a unique DB constraint would break the overwrite flow (update-in-place), so duplicate enforcement remains application-level but becomes blocking.

**Alternatives considered**:
- **Add unique DB constraint + upsert**: Rejected because upsert semantics in Drizzle require the unique constraint, but the overwrite flow needs to update the existing row and its linked billed cost atomically, which is more complex than a simple upsert.
- **Keep soft warning only**: Rejected because it doesn't prevent budget double-counting, which is the core problem.

## R2: Duplicate Check Timing (Client vs Server)

**Decision**: Introduce a dedicated server action `checkInvoiceDuplicate(invoiceNumber)` called client-side after extraction completes, before the form is submitted.

**Rationale**: The duplicate check must happen after the invoice number is known (post-extraction) but before the save. A separate action allows the UI to display the duplicate dialog without submitting the form. For bulk uploads, the check happens server-side in a new `checkBulkDuplicates(invoiceNumbers[])` action called before the batch review screen renders.

**Alternatives considered**:
- **Check during save only**: Rejected because the admin would fill out the form, submit, and only then learn about the duplicate — poor UX.
- **Check in the extraction action**: Rejected because the invoice number may be edited by the admin after extraction.

## R3: Overwrite Strategy for Single Uploads

**Decision**: Update-in-place — modify the existing invoice row and its linked billed cost rather than delete + re-create.

**Rationale**: Update-in-place preserves the original invoice ID and any audit history references (`recordCreation` in `src/actions/history.ts`). The existing `linkedBilledCostId` foreign key with `onDelete: "set null"` means we can safely update or replace the billed cost. When the new invoice date maps to a different budget period, the old billed cost is deleted and a new one is created in the correct period.

**Alternatives considered**:
- **Delete old + insert new**: Rejected because it breaks referential integrity for audit history and changes the invoice ID.
- **Soft-delete old + insert new**: Rejected as over-engineering — no soft-delete infrastructure exists.

## R4: Bulk Duplicate UX (Skip-Only)

**Decision**: Bulk upload flags duplicates as "skip" on the batch review screen. No per-row overwrite option.

**Rationale**: The batch review screen (`src/app/invoices/bulk/bulk-upload-form.tsx`) uses TanStack Table with editable rows. Adding a per-row skip/overwrite toggle for each duplicate would significantly complicate the UI. The simpler approach — flag duplicates, auto-skip on save — covers the primary use case (monthly reconciliation re-uploads). Admins needing to overwrite can re-upload individual invoices.

**Alternatives considered**:
- **Per-row overwrite toggle**: Rejected for complexity; would need per-row confirmation dialogs.
- **Batch-level "overwrite all duplicates" toggle**: Rejected as dangerous — could unintentionally overwrite invoices the admin didn't intend to change.

## R5: Amount Display Conversion (Dollars vs Cents)

**Decision**: Change the invoice upload form to accept dollar input (like the existing billed cost forms) and convert to cents on submission. Use the existing `formatCurrency()` utility for display.

**Rationale**: The billed cost add/edit dialogs in `src/app/budget/[id]/budget-detail-client.tsx` already use dollar input with `step="0.01"` and convert via `Math.round(parseFloat(value) * 100)`. The invoice upload form (`src/app/invoices/new/invoice-upload-form.tsx:248-257`) is the only place that shows "Amount (cents)" — an inconsistency. The extraction layer (`src/lib/invoice-extraction.ts`) returns `amountCents` as an integer; the form will divide by 100 for display and multiply back for storage. The Zod schema `createInvoiceSchema` validates `amountCents` as `z.number().int().positive()` — this stays unchanged; the conversion happens in the form layer.

**Alternatives considered**:
- **Change the Zod schema to accept dollars**: Rejected because other consumers of `createInvoiceSchema` (e.g., `saveBulkInvoices`) also pass cents. Keeping the schema in cents maintains a single source of truth.
- **Add a separate `amountDollars` field to the schema**: Rejected as unnecessary — the conversion is a UI concern, not a validation concern.

## R6: Within-Batch Duplicate Detection

**Decision**: After extraction, scan the batch for duplicate invoice numbers within the same zip. Flag the second (and subsequent) occurrences as within-batch duplicates.

**Rationale**: The current `saveBulkInvoices` calls `saveInvoice` per item sequentially. If two PDFs in the same zip share an invoice number, both would be inserted (since there's no unique constraint). The within-batch check runs client-side on the batch review data before submission.

**Alternatives considered**:
- **Server-side within-batch check**: Rejected — the data is already client-side in the review table; no need for a round-trip.

## R7: R2 Cleanup on Skip

**Decision**: When a single upload is skipped (duplicate rejected), delete the already-uploaded PDF from R2 using the existing `DeleteObjectCommand` pattern.

**Rationale**: The PDF is uploaded to R2 before extraction (`src/app/api/invoices/upload-url/route.ts`), so by the time the duplicate is detected, the blob already exists. The existing cleanup pattern (`src/actions/invoices.ts:124-129`) provides the template. For bulk uploads, skipped duplicates' blobs are cleaned up during the save phase.

**Alternatives considered**:
- **Defer upload until after duplicate check**: Rejected because extraction requires the PDF to be in R2 (the extraction function fetches from R2 by object key).
