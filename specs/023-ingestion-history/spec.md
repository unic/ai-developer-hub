# Feature Specification: Ingestion History Tab

**Feature Branch**: `023-ingestion-history`
**Created**: 2026-03-26
**Status**: Draft
**Input**: User description: "The ingestion should be separated from the sync status into its own settings subtab. The new tab should display all historical data of ingested documents. It should be renamed to represent the more generic character as it can ingest github, claude and maybe other billing data. Possible errors should be displayed similar to the errors in the sync status history table, with a clickable detail. The historical data for ingestion should show the success status, as well as all metadata in a filterable and sortable table. The provided document should be downloadable."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Browse Ingestion History (Priority: P1)

As an administrator, I want to view all historically ingested billing documents in a dedicated settings subtab so that I can audit what has been processed, see their outcomes, and quickly find specific entries.

The new "Ingestion" subtab appears alongside the existing "Sync Status" subtab within Settings. It displays a table of all document-based ingestion attempts (Claude Team invoices and any future billing documents submitted via upload or API) with columns for status, source/vendor, document identifier, date, amount, who uploaded it, and when it was ingested. The table supports column sorting and filtering so administrators can narrow down results by vendor, status, or date range.

**Why this priority**: This is the core value proposition — giving administrators a single, dedicated view of all ingestion activity across billing sources, separated from the automated sync jobs.

**Independent Test**: Can be fully tested by navigating to Settings > Ingestion and verifying the table loads with historical ingestion records, supports sorting by any column, and filtering by status and vendor.

**Acceptance Scenarios**:

1. **Given** an administrator has ingested invoices via the upload form and the API ingest endpoint, **When** they navigate to Settings > Ingestion, **Then** they see a table listing all ingested documents with status, vendor, document number, date, amount, uploader, and ingestion timestamp.
2. **Given** the ingestion history table is displayed, **When** the administrator clicks a column header, **Then** the table sorts by that column (ascending/descending toggle).
3. **Given** the ingestion history table is displayed, **When** the administrator applies a filter by vendor (e.g., "Anthropic"), **Then** only ingestion records from that vendor are shown.
4. **Given** the ingestion history table is displayed, **When** the administrator applies a filter by status (e.g., "Failed"), **Then** only records with that outcome are shown.
5. **Given** no documents have been ingested yet, **When** the administrator opens the Ingestion tab, **Then** an empty state message is displayed with guidance on how to ingest documents.

---

### User Story 2 - View Ingestion Error Details (Priority: P1)

As an administrator, I want to see detailed error information for failed ingestions so that I can diagnose issues and take corrective action.

When an ingestion fails (extraction error, duplicate, validation failure), the error message appears in the table row. Clicking the error opens a popover or detail view showing the full error message, similar to the error display pattern used in the Sync Status history table.

**Why this priority**: Error visibility is critical for operational reliability — administrators must be able to diagnose why a document failed ingestion without digging through logs.

**Independent Test**: Can be tested by ingesting a document that triggers a known error (e.g., a duplicate invoice number) and verifying the error detail is visible and clickable in the Ingestion tab.

**Acceptance Scenarios**:

1. **Given** a document ingestion failed with an error, **When** the administrator views the Ingestion tab, **Then** the row shows a "Failed" status badge and a truncated error message.
2. **Given** a row has a truncated error message, **When** the administrator clicks the error text, **Then** a popover displays the full error message with scrollable content and preserved formatting.
3. **Given** a document was ingested successfully, **When** the administrator views that row, **Then** no error detail is shown and the status badge shows "Success".

---

### User Story 3 - Download Ingested Document (Priority: P2)

As an administrator, I want to download the original document (PDF) that was ingested so that I can review or archive the source material.

Each row in the ingestion history table includes a download action. Clicking it retrieves the original uploaded document via a secure, time-limited URL.

**Why this priority**: Document retrieval is essential for audit and reconciliation but is secondary to being able to see and filter the history.

**Independent Test**: Can be tested by clicking the download button on an ingestion record and verifying the original PDF opens or downloads.

**Acceptance Scenarios**:

1. **Given** a successfully ingested document exists, **When** the administrator clicks the download button on that row, **Then** the browser initiates a download of the original PDF file.
2. **Given** a document's storage reference is missing or invalid, **When** the administrator clicks the download button, **Then** a user-friendly error message is shown instead of a broken download.

---

### User Story 4 - Dedicated Navigation Subtab (Priority: P2)

As an administrator, I want the Ingestion tab to be clearly separated from the Sync Status tab so that I can navigate between automated sync monitoring and document ingestion history without confusion.

The Settings page gains a new subtab labeled "Ingestion" (or similar generic label) that sits alongside the existing "Sync Status" tab. The naming reflects the generic nature of the feature — it covers billing documents from any source, not just Claude invoices.

**Why this priority**: Clean navigation separation ensures administrators don't conflate scheduled sync jobs with document ingestion, reducing cognitive load.

**Independent Test**: Can be tested by verifying the new tab appears in Settings navigation for admin users, routes to its own URL, and visually highlights when active.

**Acceptance Scenarios**:

1. **Given** an administrator is on the Settings page, **When** they view the tab navigation, **Then** they see an "Ingestion" tab alongside "Sync Status" and other existing tabs.
2. **Given** the administrator clicks the "Ingestion" tab, **When** the page loads, **Then** the URL changes to the ingestion route and the tab is visually active.
3. **Given** a non-admin user is on the Settings page, **When** they view the tab navigation, **Then** the "Ingestion" tab is not visible.

---

### Edge Cases

- What happens when a document was ingested via the API endpoint but the PDF was not stored (e.g., storage was unavailable)? The download button should be disabled or show an appropriate message.
- What happens when hundreds of ingestion records exist? The table should handle pagination to remain performant.
- What happens when multiple filters are applied simultaneously (e.g., vendor = "Anthropic" AND status = "Failed")? Filters should compose additively.
- What happens when the ingestion record has no vendor (null)? The table should display a fallback value (e.g., "Unknown").
- What happens when an ingestion was a duplicate (409 response)? This should appear as a distinct status or be captured in the error detail.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a dedicated "Ingestion" subtab in the Settings area, visible only to administrators.
- **FR-002**: The Ingestion tab MUST display a table of all document-based ingestion attempts (manual uploads, API ingest endpoint, bulk uploads), regardless of vendor. Automated sync results (e.g., GitHub Copilot billing via cron) are excluded and remain in Sync Status.
- **FR-003**: The ingestion history table MUST show the following metadata per record: ingestion status (success/failed), document identifier (invoice number), vendor/source, document date, amount, uploader (user name or "API"), and ingestion timestamp.
- **FR-004**: The table MUST support sorting by any displayed column (ascending and descending).
- **FR-005**: The table MUST support filtering by at least status and vendor/source.
- **FR-006**: Failed ingestion records MUST display error details in a clickable popover, consistent with the error display pattern used in the Sync Status history table.
- **FR-007**: Each ingestion record with an associated document MUST provide a download action that retrieves the original file via a secure, time-limited URL.
- **FR-008**: The download action MUST be disabled or show an informative message when the document is unavailable.
- **FR-009**: The table MUST display an empty state with guidance when no ingestion records exist.
- **FR-010**: The "Ingestion" label and framing MUST be generic (not "Claude Invoices") to reflect that it covers billing documents from multiple sources.
- **FR-011**: The table MUST handle large datasets gracefully through pagination.

### Key Entities

- **Ingestion Log Entry**: Represents a single document ingestion attempt (success or failure), stored in a dedicated `ingestion_log` table. Key attributes: status outcome (success/failed), error message (if failed), source/vendor, document identifier, date, monetary amount, uploader identity, ingestion channel (manual/API/bulk), ingestion timestamp, and reference to the stored document (if successful). This table is the primary data source for the Ingestion History tab.
- **Ingested Document**: The original billing document (typically PDF) stored in object storage. Referenced by the ingestion log entry for download purposes. Only exists for successful ingestions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Administrators can locate any specific ingestion record within 15 seconds using the filter and sort controls.
- **SC-002**: 100% of ingestion errors are visible to administrators without requiring access to application logs.
- **SC-003**: Administrators can download any previously ingested document within 2 clicks from the Ingestion tab.
- **SC-004**: The Ingestion tab loads and displays records within 2 seconds for up to 500 records.
- **SC-005**: The Ingestion tab is fully separated from Sync Status — no ingestion-specific data appears in the Sync Status tab and vice versa.

## Clarifications

### Session 2026-03-26

- Q: How should failed ingestion attempts be persisted? → A: Create a new `ingestion_log` table dedicated to tracking all ingestion attempts (success and failure) with metadata.
- Q: Should the Ingestion History tab include automated sync results or only document-based ingestions? → A: Only document-based ingestions (manual uploads, API ingest endpoint, bulk uploads) — not automated syncs.

## Assumptions

- A new `ingestion_log` table will be created to track all ingestion attempts (both successful and failed). This is the primary data source for the Ingestion History tab. The existing `invoices` table continues to store only successfully ingested documents.
- The existing PDF download route with presigned URLs will be reused for document downloads.
- The existing error popover and status badge components from the Sync Status page will be reused for visual consistency.
- Ingestion records include both manually uploaded invoices (via the UI) and programmatically submitted invoices (via the ingest API endpoint).
- Pagination will use a standard page-size approach (e.g., 20 records per page) rather than infinite scroll.
