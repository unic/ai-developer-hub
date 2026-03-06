# API Contracts: Invoice Duplicate Handling & Amount Display

**Feature**: 008-invoice-duplicate-handling
**Date**: 2026-03-06

## New Server Actions

### checkInvoiceDuplicate

**Purpose**: Check if an invoice number already exists in the database. Called client-side after extraction or after the admin edits the invoice number field.

**Input**:
```
{ invoiceNumber: string }
```

**Output (success)**:
```
{
  success: true,
  data: {
    isDuplicate: false
  }
}
```

**Output (duplicate found)**:
```
{
  success: true,
  data: {
    isDuplicate: true,
    existingInvoice: {
      id: number,
      invoiceNumber: string,
      invoiceDate: string,       // YYYY-MM-DD
      amountCents: number,
      vendor: string | null,
      linkedBilledCostId: number | null
    }
  }
}
```

**Output (error)**:
```
{ success: false, error: string }
```

---

### checkBulkDuplicates

**Purpose**: Batch check multiple invoice numbers against the database. Called after zip extraction before rendering the batch review screen.

**Input**:
```
{ invoiceNumbers: string[] }
```

**Output (success)**:
```
{
  success: true,
  data: {
    duplicates: Record<string, {
      id: number,
      invoiceDate: string,
      amountCents: number,
      vendor: string | null
    }>
  }
}
```

The `duplicates` map is keyed by invoice number. Only numbers with existing matches are included. An empty object means no duplicates.

**Output (error)**:
```
{ success: false, error: string }
```

---

### overwriteInvoice (new)

**Purpose**: Replace an existing invoice record with new data. Updates the invoice row, handles R2 blob swap, and updates or re-creates the linked billed cost.

**Input**:
```
{
  existingInvoiceId: number,
  invoiceNumber: string,
  invoiceDate: string,          // YYYY-MM-DD
  amountCents: number,
  vendor?: string,
  blobUrl: string,
  blobPathname: string
}
```

**Output (success)**:
```
{
  success: true,
  data: { id: number },
  linkedPeriodLabel?: string,
  linkWarning?: string
}
```

**Output (error)**:
```
{ success: false, error: string }
```

**Behavior**:
1. Fetch existing invoice (including old `blobPathname` and `linkedBilledCostId`)
2. Update invoice row: `invoiceDate`, `amountCents`, `vendor`, `blobUrl`, `blobPathname`, `updatedAt`
3. Delete old R2 blob (best-effort)
4. Handle linked billed cost:
   - If existing billed cost exists and new date maps to same period → update billed cost in place
   - If existing billed cost exists and new date maps to different period → delete old billed cost, create new one in correct period
   - If no existing billed cost → attempt auto-link (same as fresh upload)
   - If no matching period → save without link, return `linkWarning`
5. Return updated invoice ID and linking result

---

### cleanupBlob (new — internal helper)

**Purpose**: Delete an R2 object by key. Used when skipping a duplicate (single upload) or cleaning up skipped blobs in bulk upload.

**Input**:
```
{ blobPathname: string }
```

**Behavior**: Best-effort deletion. Failures are logged but do not propagate errors. Not exposed as a public server action — called internally by other actions and the skip handler.

---

## Modified Server Actions

### saveInvoice (existing — modified)

**Changes**:
- Remove the current soft duplicate check (lines 102-106 and warning on line 171)
- The duplicate check is now handled separately by `checkInvoiceDuplicate` before `saveInvoice` is called
- `saveInvoice` becomes a pure insert action (no duplicate awareness)
- If called with a duplicate invoice number (e.g., race condition), the insert succeeds as before (no DB constraint) — the UI-level check is the primary gate

### saveBulkInvoices (existing — modified)

**Changes**:
- Accept an additional `skip` boolean per item in the input array
- Items marked `skip: true` are not saved; their R2 blobs are cleaned up
- The outcome array includes `skipped: true` and `skipReason` for skipped items
- Non-skipped items proceed through `saveInvoice` as before

**Updated input type**:
```
Array<CreateInvoiceInput & { filename: string; skip?: boolean; skipReason?: string }>
```

**Updated outcome type**:
```
{
  filename: string,
  invoiceId?: number,
  linkedPeriodLabel?: string,
  linkWarning?: string,
  error?: string,
  skipped?: boolean,
  skipReason?: string
}
```

---

## UI Contracts

### Single Upload Form — Duplicate Dialog

**Trigger**: After extraction completes AND after the admin confirms/edits the invoice number, call `checkInvoiceDuplicate`. If duplicate found, show a dialog before allowing form submission.

**Dialog content**:
- Warning message: "An invoice with this number already exists"
- Existing invoice details: number, date, amount (formatted as dollars), vendor
- Two action buttons: "Skip (Cancel Upload)" and "Overwrite Existing"

**Skip action**: Call `cleanupBlob` with the new upload's `blobPathname`, reset form
**Overwrite action**: Call `overwriteInvoice` with the new data and existing invoice ID

### Single Upload Form — Amount Field

**Current**: `<input type="number">` with label "Amount (cents)", placeholder "e.g. 12500 for $125.00"

**New**: `<input type="number" step="0.01" min="0.01">` with label "Amount ($)", placeholder "0.00"

**Conversion**:
- After extraction: `setValue("amountDollars", (extractedAmountCents / 100).toFixed(2))`
- On submit: `amountCents = Math.round(parseFloat(amountDollars) * 100)`

### Bulk Review Screen — Duplicate Flags

**Visual indicator**: Duplicate rows get a warning badge/icon and muted styling. The row is non-editable when flagged as duplicate.

**Skip column**: A "Status" column shows "Duplicate — will be skipped" for flagged rows, or a checkmark for new invoices.

**Amount column**: All amounts displayed in dollars (converted from extracted cents).
