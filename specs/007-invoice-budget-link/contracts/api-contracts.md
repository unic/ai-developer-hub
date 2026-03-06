# API Contracts: Invoice–Budget Integration

**Feature**: 007-invoice-budget-link
**Date**: 2026-03-05

---

## Existing Endpoint — No Change

### `POST /api/invoices/upload-url`

Accepts `multipart/form-data` with a single PDF `file` field. Unchanged from the previous feature. Returns `{ objectKey, blobUrl }`.

---

## New Endpoint

### `POST /api/invoices/bulk-upload`

Accepts a zip archive containing PDF invoices. Extracts each PDF, uploads to storage, and runs field extraction. Returns draft extraction results for batch review. Does **not** save to the database.

**Auth**: Admin session required (401 if not authenticated).

**Request**:
```
Content-Type: application/zip
Body: raw zip archive bytes (max 50 MB)
```

**Validation**:
- `Content-Type` must be `application/zip` or `application/x-zip-compressed`
- Zip must contain at least 1 PDF entry
- Zip must contain at most 50 PDF entries (others skipped and reported)
- Non-PDF entries are silently skipped and listed in `skipped`

**Response 200**:
```json
{
  "results": [
    {
      "filename": "acme-invoice-jan.pdf",
      "objectKey": "invoices/{uuid}.pdf",
      "blobUrl": "https://…",
      "extracted": {
        "invoiceNumber": "INV-1042",
        "invoiceDate": "2025-01-15",
        "amountCents": 12500,
        "vendor": "Acme Corp",
        "confidence": {
          "invoiceNumber": "high",
          "invoiceDate": "high",
          "amountCents": "medium",
          "vendor": "high"
        }
      },
      "error": null
    },
    {
      "filename": "broken.pdf",
      "objectKey": "invoices/{uuid}.pdf",
      "blobUrl": "https://…",
      "extracted": null,
      "error": "PDF has no readable text layer"
    }
  ],
  "skipped": ["readme.txt"]
}
```

**Response 400**: `{ "error": "No PDF files found in zip" }` / `{ "error": "Invalid file type" }` / `{ "error": "Zip exceeds 50 MB limit" }`
**Response 401**: `{ "error": "Unauthorized" }`
**Response 500**: `{ "error": "Failed to process zip: {message}" }`

---

## Server Actions

### `saveInvoice` — Updated Return Shape

Existing action. Response extended with optional linking fields:

```typescript
// Success, linked to budget period
{ success: true, data: { id: number }, linkedPeriodLabel: string }

// Success, no matching period found
{ success: true, data: { id: number }, linkWarning: string }

// Failure
{ success: false, error: string }
```

### `saveBulkInvoices` — New Action

```typescript
// Input
type BulkInvoiceInput = CreateInvoiceInput[]  // max 50 items

// Output
type BulkSaveResult = {
  success: true
  results: Array<{
    filename: string
    invoiceId: number
    linkedPeriodLabel?: string
    linkWarning?: string
  }>
} | {
  success: false
  error: string
  partialResults?: Array<{ filename: string; error: string }>
}
```

Each invoice is saved independently. A failure on one item does not prevent others from saving. Partial results are returned so the UI can report per-file outcomes.
