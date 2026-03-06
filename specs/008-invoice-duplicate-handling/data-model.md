# Data Model: Invoice Duplicate Handling & Amount Display

**Feature**: 008-invoice-duplicate-handling
**Date**: 2026-03-06

## Existing Entities (No Schema Changes)

This feature does not require database schema changes. All modifications are at the application and UI layer. The existing schema supports everything needed.

### invoices (existing — unchanged)

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | serial | PK | Preserved on overwrite (update-in-place) |
| invoiceNumber | varchar(255) | NOT NULL, indexed (non-unique) | Duplicate detection key |
| invoiceDate | date | NOT NULL | Updated on overwrite |
| amountCents | integer | NOT NULL | Stored as cents; displayed as dollars in UI |
| vendor | varchar(255) | nullable | Updated on overwrite |
| linkedBilledCostId | integer | FK → billed_costs.id, ON DELETE SET NULL | Updated/replaced on overwrite |
| blobUrl | text | NOT NULL | Updated on overwrite; old blob deleted from R2 |
| blobPathname | text | NOT NULL | Updated on overwrite; old key used for R2 cleanup |
| uploadedBy | integer | NOT NULL, FK → users.id | Unchanged on overwrite (original uploader preserved) |
| createdAt | timestamp | NOT NULL, default now() | Unchanged on overwrite |
| updatedAt | timestamp | NOT NULL, default now() | Set to now() on overwrite |

**Design decision**: `invoiceNumber` remains non-unique at the DB level. Uniqueness is enforced at the application layer with explicit user choice (skip/overwrite). A unique constraint would require `ON CONFLICT` upsert syntax which doesn't support the linked billed cost update logic cleanly.

### billed_costs (existing — unchanged)

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | serial | PK | May be deleted + re-created if period changes on overwrite |
| periodId | integer | NOT NULL, FK → budget_periods.id, ON DELETE CASCADE | Determines which budget period the cost belongs to |
| amountCents | integer | NOT NULL | Updated on overwrite |
| invoiceDate | date | NOT NULL | Updated on overwrite |
| description | varchar(500) | NOT NULL | Pattern: "Invoice {number} — {vendor}" or "Invoice {number}" |
| vendorReference | varchar(255) | nullable | Stores the invoice number |
| createdAt | timestamp | NOT NULL, default now() | |
| updatedAt | timestamp | NOT NULL, default now() | Set to now() on update |

## State Transitions

### Single Upload Flow (with duplicate detection)

```
PDF uploaded to R2
  → Fields extracted
    → Invoice number checked against DB
      → No match → Normal save flow (unchanged)
      → Match found → Duplicate dialog shown
        → Admin chooses "Skip"
          → R2 blob deleted, no DB changes
        → Admin chooses "Overwrite"
          → Existing invoice updated (date, amount, vendor, blob refs)
          → Old R2 blob deleted
          → Linked billed cost handling:
            → Same period: update billed cost in place
            → Different period: delete old billed cost, create new in correct period
            → No existing billed cost: attempt auto-link to period (same as fresh upload)
            → No matching period: save invoice without link, show warning
```

### Bulk Upload Flow (with duplicate detection)

```
ZIP uploaded, PDFs extracted
  → Each PDF: uploaded to R2, fields extracted
    → All invoice numbers checked against DB (batch query)
    → Within-batch duplicates detected (client-side)
    → Batch review screen shown:
      → Duplicates (DB match): flagged, pre-marked "Skip"
      → Within-batch duplicates: second occurrence flagged
      → New invoices: normal editable rows
    → Admin submits batch
      → Skipped rows: R2 blobs cleaned up
      → Non-skipped rows: saved via existing saveInvoice flow
      → Outcome summary: saved / skipped (duplicate) / failed
```

## Transient Types (Client-Side Only)

### DuplicateCheckResult

Returned by the new `checkInvoiceDuplicate` server action:

- `isDuplicate`: boolean
- `existingInvoice` (if duplicate): { id, invoiceNumber, invoiceDate, amountCents, vendor, linkedBilledCostId }

### BulkDuplicateCheckResult

Returned by the new `checkBulkDuplicates` server action:

- `duplicates`: Map<invoiceNumber, { id, invoiceDate, amountCents, vendor }>

### BulkSaveOutcome (enhanced)

Extended from existing type to include skip reason:

- `filename`: string
- `invoiceId?`: number
- `linkedPeriodLabel?`: string
- `linkWarning?`: string
- `error?`: string
- `skipped?`: boolean
- `skipReason?`: "duplicate" | "within-batch-duplicate"

## Validation Rules

### Amount Display Conversion

- **UI layer**: Accepts dollar input as `number` with `step="0.01"`
- **Conversion**: `amountCents = Math.round(dollarValue * 100)`
- **Reverse**: `dollarValue = (amountCents / 100).toFixed(2)`
- **Zod schema**: Unchanged — `amountCents` remains `z.number().int().positive()`
- **Extraction layer**: Unchanged — returns `amountCents` as integer cents

### Duplicate Detection

- **Key**: `invoiceNumber` (case-sensitive, exact match)
- **Scope**: All invoices in the database (no date/vendor filtering)
- **Within-batch**: Second occurrence of same `invoiceNumber` in a single zip upload
