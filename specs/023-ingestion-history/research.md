# Research: Ingestion History Tab

**Feature**: 023-ingestion-history | **Date**: 2026-03-26

## R1: Ingestion Log Table Design

**Decision**: Create a new `ingestion_log` table to track all document ingestion attempts (success and failure), separate from the `invoices` table.

**Rationale**: The existing `invoices` table only stores successfully ingested documents. Failed attempts (validation errors, extraction failures, duplicates) return HTTP errors without persisting a record. A dedicated log table captures the full ingestion lifecycle without polluting the invoices table with incomplete data.

**Alternatives considered**:
- Adding a `status` column to `invoices` — rejected because it would mix incomplete/failed records with valid invoice data used by budget linking and reporting.
- Reusing `sync_events` — rejected because sync events are designed for automated batch syncs with counts (created/updated/skipped), not individual document ingestion attempts.

**Schema Design**:
- New enum: `ingestion_outcome` with values `success`, `failed`
- New enum: `ingestion_channel` with values `manual`, `api`, `bulk`
- Columns: id, filename, vendor, invoice_number (nullable for failures), invoice_date (nullable), amount_cents (nullable), outcome, error_message, channel, blob_pathname (nullable), linked_invoice_id (nullable FK to invoices), uploaded_by (FK to users, nullable for API), created_at
- Indexes: outcome, created_at, vendor, uploaded_by

## R2: Settings Navigation Pattern

**Decision**: Add "Ingestion" as a new admin-only tab in the existing `SettingsNav` component, routing to `/settings/ingestion`.

**Rationale**: The settings navigation uses a simple array-based tab definition with admin gating. Adding a new entry to `adminTabs` is the established pattern. No subtab system exists — each tab is a top-level route under `/settings/`.

**Implementation**: Add `{ label: "Ingestion", href: "/settings/ingestion" }` to the `adminTabs` array in `settings-nav.tsx`.

## R3: DataTable Reuse for Ingestion History

**Decision**: Reuse the existing `DataTable` component with faceted filters for status and vendor columns.

**Rationale**: The `DataTable` wrapper already supports sorting, column filters, faceted multi-select filters, global search, and pagination (10/25/50/100 page sizes). This exactly matches FR-004, FR-005, and FR-011.

**Pattern**: Define `ColumnDef<IngestionLogRow>[]` with `DataTableColumnHeader` for sortable columns. Configure `facetedFilters` prop for status and vendor dropdowns.

## R4: Error Display and Status Badge Reuse

**Decision**: Reuse `ErrorPopover` and `OutcomeBadge` components from the sync status page.

**Rationale**: Both components are already generic — `ErrorPopover` takes any `errorMessage: string | null`, and `OutcomeBadge` maps outcome strings to badge variants. The ingestion outcomes (`success`, `failed`) are a subset of the sync outcomes already supported.

**Note**: Move these components from `src/app/settings/sync/` to a shared location (e.g., `src/components/`) since they'll now be used by two different settings pages.

## R5: Ingestion Logging Hookpoints

**Decision**: Instrument three existing ingestion flows to write to `ingestion_log`:
1. **API ingest endpoint** (`/api/invoices/ingest/route.ts`) — log on both success and error responses
2. **Manual upload** (`actions/invoices.ts` → `saveInvoice`) — log on success, log extraction failures in the upload form
3. **Bulk upload** (`actions/invoices.ts` → `saveBulkInvoices`) — log each item's outcome individually

**Rationale**: These are the three document-based ingestion channels identified in the spec clarification. Each produces enough context (filename, vendor, amounts, errors) to populate the log.

## R6: Document Download

**Decision**: Reuse the existing `/api/invoices/[id]/pdf` route for downloads. The ingestion log stores `linked_invoice_id` for successful ingestions, which maps to the invoice record containing the blob reference.

**Rationale**: The presigned URL generation and R2 integration already exist. No new download infrastructure needed.

**Edge case**: Failed ingestions have no `linked_invoice_id` and no stored document — the download button will be disabled for these rows.

## R7: Migration Strategy

**Decision**: Create migration `0014_add_ingestion_log.sql` with the new table and enums.

**Rationale**: Next available migration number is 0014. The codebase uses Drizzle's migration system with idempotent DO blocks and `IF NOT EXISTS` guards.
