# Data Model: Ingestion History Tab

**Feature**: 023-ingestion-history | **Date**: 2026-03-26

## New Entities

### ingestion_log

Tracks every document ingestion attempt across all channels (manual upload, API endpoint, bulk upload). Both successful and failed attempts are recorded.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | serial | NO | auto | Primary key |
| filename | varchar(500) | YES | null | Original filename of the uploaded document |
| vendor | varchar(255) | YES | null | Extracted or inferred vendor (e.g., "Anthropic") |
| invoice_number | varchar(255) | YES | null | Extracted invoice number (null if extraction failed) |
| invoice_date | date | YES | null | Extracted invoice date (null if extraction failed) |
| amount_cents | integer | YES | null | Extracted amount in cents (null if extraction failed) |
| outcome | ingestion_outcome | NO | — | `success` or `failed` |
| error_message | text | YES | null | Error details for failed ingestions |
| channel | ingestion_channel | NO | — | `manual`, `api`, or `bulk` |
| blob_pathname | text | YES | null | R2 object key (null for failed ingestions where upload didn't occur) |
| linked_invoice_id | integer (FK → invoices.id) | YES | null | Reference to created invoice record (null for failures) |
| uploaded_by | integer (FK → users.id) | YES | null | User who initiated the ingestion (null for API/system) |
| created_at | timestamp | NO | now() | When the ingestion attempt occurred |

**Indexes**:
- `ingestion_log_outcome_idx` on (outcome)
- `ingestion_log_created_at_idx` on (created_at)
- `ingestion_log_vendor_idx` on (vendor)
- `ingestion_log_channel_idx` on (channel)

**Relations**:
- `linked_invoice_id` → `invoices.id` (one-to-one, ON DELETE SET NULL)
- `uploaded_by` → `users.id` (many-to-one, ON DELETE SET NULL)

### New Enums

**ingestion_outcome**: `success`, `failed`

**ingestion_channel**: `manual`, `api`, `bulk`

## Modified Entities

None. The existing `invoices` table is not modified. The `ingestion_log` table references it via `linked_invoice_id`.

## State Transitions

Ingestion log entries are **immutable** — they are written once at the conclusion of an ingestion attempt and never updated. There is no state machine; the `outcome` is final at insert time.

## Data Volume Estimates

- Expected volume: 10–50 ingestion attempts per month (small team)
- Growth: Linear with billing frequency and team size
- Retention: No automatic cleanup — all history preserved for audit
- Pagination at 20 rows/page handles up to several thousand records comfortably

## Entity Relationship Summary

```
users ──────┐
            │ uploaded_by (nullable)
            ▼
     ingestion_log
            │ linked_invoice_id (nullable)
            ▼
        invoices ──→ billed_costs ──→ budget_periods
```
