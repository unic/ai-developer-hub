# API Contracts: Invoice PDF Upload & Auto-Processing

**Feature**: `006-invoice-pdf-upload`
**Phase**: 1 — Design
**Date**: 2026-03-05

These are the two new HTTP Route Handlers this feature introduces. All Server Actions are internal (not HTTP contracts) and follow the existing `{ success: true, data } | { success: false, error }` pattern.

---

## POST `/api/invoices/upload-url`

Generates a short-lived Cloudflare R2 presigned PUT URL. The client uses this URL to upload the PDF binary directly to R2, bypassing the 4.5 MB Vercel Function body limit. The server also assigns the object key, keeping naming under server control.

### Authentication
- Session required (NextAuth `auth()`)
- Role: `admin` only (`requireAdmin()`)
- Returns `401` for unauthenticated or non-admin requests

### Request

```
POST /api/invoices/upload-url
Content-Type: application/json
```

```json
{ "filename": "invoice.pdf", "contentType": "application/pdf" }
```

### Response — Success

```json
{
  "uploadUrl": "https://<account>.r2.cloudflarestorage.com/<bucket>/invoices/<uuid>.pdf?X-Amz-...",
  "objectKey": "invoices/<uuid>.pdf"
}
```

- `uploadUrl`: presigned PUT URL valid for **5 minutes**. The client must PUT the raw PDF bytes directly to this URL.
- `objectKey`: the R2 object key the server assigned. The client passes this back in the `extractInvoiceFields` Server Action call and the `saveInvoice` Server Action call.

### Error Responses

| Status | Body | When |
|---|---|---|
| `401` | `{ "error": "Unauthorized" }` | No session or non-admin role |
| `400` | `{ "error": "Invalid file type" }` | `contentType` is not `application/pdf` |

### Client upload (after receiving the response)

```ts
await fetch(uploadUrl, {
  method: "PUT",
  body: file,                          // the File object from <input type="file">
  headers: { "Content-Type": "application/pdf" },
})
// then call extractInvoiceFields({ objectKey })
```

### Constraints
- Only `application/pdf` content type accepted; validated server-side before generating the URL
- Object key is server-generated (`invoices/<uuid>.pdf`); client cannot override it
- Presigned URL expires in 5 minutes — sufficient for any real upload

---

## GET `/api/invoices/[id]/pdf`

Authenticated download redirect for a stored invoice PDF. Generates a short-lived R2 presigned GET URL using the `blob_pathname` (object key) stored in Neon and redirects the client to it.

### Authentication
- Session required (NextAuth `auth()`)
- Role: `admin` only (`requireAdmin()`)
- Returns `401` for unauthenticated or non-admin requests

### Request

```
GET /api/invoices/:id/pdf
```

| Parameter | Type | Description |
|---|---|---|
| `id` | integer (path) | Invoice record ID in Neon |

### Response — Success

```
HTTP 302 Found
Location: https://<account>.r2.cloudflarestorage.com/<bucket>/invoices/<uuid>.pdf?X-Amz-...
```

The presigned GET URL expires in **5 minutes**. The browser follows the redirect and downloads the PDF directly from R2.

### Error Responses

| Status | Body | When |
|---|---|---|
| `401` | `Unauthorized` | No session or non-admin role |
| `404` | `Not found` | Invoice ID does not exist in DB |
| `500` | `Storage error` | R2 presigned URL generation failed |

### Notes
- `id` is validated as a positive integer before the DB query; invalid IDs return `404`
- The presigned URL is time-limited (5 min) — acceptable for an internal admin tool
- R2 bucket is private; the presigned URL is the only access path and expires automatically

---

## Server Actions (internal contracts)

These are not HTTP endpoints but define the TypeScript contracts used by client components.

### `extractInvoiceFields({ objectKey: string }): Promise<ActionResult<InvoiceExtractionResult>>`
Fetches PDF from Cloudflare R2 using `GetObjectCommand`, extracts text with `unpdf`, calls Claude Haiku with forced tool use, returns structured extraction result.

```ts
type InvoiceExtractionResult = {
  invoiceNumber: string | null;
  invoiceDate: string | null;       // YYYY-MM-DD or null
  amountCents: number | null;       // integer cents or null
  confidence: {
    invoiceNumber: "high" | "medium" | "low";
    invoiceDate: "high" | "medium" | "low";
    amountCents: "high" | "medium" | "low";
  };
};
```

### `saveInvoice(input: CreateInvoiceInput): Promise<ActionResult<{ id: number }>>`
Validates input with `createInvoiceSchema`, checks for duplicate `invoice_number` (soft warning), inserts into `invoices` table, records creation in `changeHistory`, calls `revalidatePath("/invoices")`.

```ts
type CreateInvoiceInput = {
  invoiceNumber: string;
  invoiceDate: string;   // YYYY-MM-DD
  amountCents: number;   // integer cents
  blobUrl: string;       // R2 public endpoint path (for reference)
  blobPathname: string;  // R2 object key (used for presigned URL generation)
};
```

On duplicate invoice number: returns `{ success: true, data: { id }, warning: "Invoice number already exists" }`.
On DB failure after upload: calls `DeleteObjectCommand(objectKey)` via the R2 client before returning the error.
