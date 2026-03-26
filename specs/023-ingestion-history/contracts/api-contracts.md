# API Contracts: Ingestion History Tab

**Feature**: 023-ingestion-history | **Date**: 2026-03-26

## Server Actions

### getIngestionHistory

Fetches paginated, filterable ingestion log entries for the Ingestion History table.

**Access**: Admin only (server-side session check)

**Input**:
```typescript
{
  page?: number;          // 1-based, default 1
  pageSize?: number;      // default 20, max 100
  sortBy?: string;        // column name, default "created_at"
  sortOrder?: "asc" | "desc"; // default "desc"
  filterStatus?: "success" | "failed" | null; // null = all
  filterVendor?: string | null; // null = all
}
```

**Output (success)**:
```typescript
{
  success: true;
  data: {
    rows: IngestionLogRow[];
    total: number;
    page: number;
    pageSize: number;
  }
}
```

**Output (error)**:
```typescript
{
  success: false;
  error: string;
}
```

**IngestionLogRow shape**:
```typescript
{
  id: number;
  filename: string | null;
  vendor: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amountCents: number | null;
  outcome: "success" | "failed";
  errorMessage: string | null;
  channel: "manual" | "api" | "bulk";
  blobPathname: string | null;
  linkedInvoiceId: number | null;
  uploaderName: string | null;
  createdAt: string; // ISO timestamp
}
```

## Modified Endpoints

### POST /api/invoices/ingest (existing)

**Change**: After processing (success or failure), write a row to `ingestion_log` before returning the response. No changes to the request/response contract.

**Ingestion log fields on success**:
- outcome: "success"
- channel: "api"
- linked_invoice_id: newly created invoice ID
- All extracted fields populated

**Ingestion log fields on failure**:
- outcome: "failed"
- channel: "api"
- error_message: the error string from the response
- Extracted fields populated where available (partial extraction)

## No New REST Endpoints

The ingestion history is served via server actions (Next.js Server Components), not REST endpoints. The existing `/api/invoices/[id]/pdf` route is reused for document downloads.
