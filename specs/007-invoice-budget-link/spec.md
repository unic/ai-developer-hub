# Feature Specification: Invoice–Budget Integration

**Feature Branch**: `007-invoice-budget-link`
**Created**: 2026-03-05
**Status**: Draft
**Input**: User description: "the uploaded invoices should be automatically linked to the budget. Every invoice in the archive has a date and amount which can be listed in the monthly periods and should be considered in the billed costs. The invoices should also have an optional vendor field that can be extracted from the file. Multiple invoices can be uploaded and processed as a zip file."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Auto-Link Invoice to Budget Period (Priority: P1)

An admin uploads a PDF invoice. After saving it to the archive, the system automatically finds the budget period that covers the invoice date and records the invoice amount as a billed cost for that period. The admin no longer needs to manually enter the same amount in the budget to track actual spend.

**Why this priority**: This is the core value proposition — closing the gap between the invoice archive and budget tracking. Without this link, both systems exist in isolation and admins must enter data twice.

**Independent Test**: Upload a single PDF invoice whose date falls inside an existing budget period. Verify the invoice appears in the budget period's billed cost list with the correct amount and reference.

**Acceptance Scenarios**:

1. **Given** an active budget with a monthly period covering invoice date, **When** an admin saves an invoice to the archive, **Then** a billed cost entry is automatically created in the matching period with the invoice amount, invoice number as the reference, and vendor name (if available) in the description.
2. **Given** no budget period exists that covers the invoice date, **When** an admin saves the invoice, **Then** the invoice is saved to the archive but no billed cost is created; the admin sees a notice that the invoice could not be linked to any budget period.
3. **Given** the matching budget has been archived, **When** an admin saves the invoice, **Then** the invoice is saved but no billed cost is created; the admin sees a notice that the budget is archived and manual linking is required.
4. **Given** an invoice was auto-linked to a period, **When** the admin views the budget period detail, **Then** the period's billed cost list shows the invoice amount and the invoice number as a reference, and the period totals reflect the new cost.

---

### User Story 2 - Vendor Field Extraction and Display (Priority: P2)

An admin uploads a PDF invoice. During extraction, the system attempts to identify the vendor name from the document and pre-fills an optional vendor field. The admin can confirm, correct, or leave it blank. The vendor name is stored with the invoice and used as part of the description when creating the linked billed cost.

**Why this priority**: The vendor field enriches both the invoice archive and the billed cost entries, making it easier to filter and report costs by supplier. It builds on the existing extraction infrastructure and does not block P1.

**Independent Test**: Upload a PDF invoice that contains a recognisable vendor name (e.g. a company header). Verify the vendor field is pre-filled, can be edited, and is stored correctly. Verify it appears on the invoice list and in the linked billed cost description.

**Acceptance Scenarios**:

1. **Given** a PDF whose text contains a vendor name, **When** the admin uploads it, **Then** the vendor field is pre-filled with the extracted value and marked with a confidence indicator consistent with the other fields.
2. **Given** a PDF with no identifiable vendor, **When** the admin uploads it, **Then** the vendor field is empty and flagged as low-confidence so the admin knows to fill it manually.
3. **Given** the admin corrects the pre-filled vendor name before saving, **When** the invoice is saved, **Then** the corrected value is stored, not the extracted one.
4. **Given** the vendor field is left blank, **When** the invoice is saved, **Then** the invoice is saved successfully without a vendor name; the linked billed cost description omits the vendor portion.

---

### User Story 3 - Batch Upload via Zip File (Priority: P3)

An admin has several PDF invoices to process at once. They package them into a zip archive and upload it in a single step. The system extracts each PDF, processes them in sequence, and presents a batch summary showing which invoices were saved, which were linked to budget periods, and which need attention.

**Why this priority**: Reduces friction for monthly reconciliation tasks where many invoices arrive together. Depends on P1 and P2 being complete.

**Independent Test**: Upload a zip file containing three PDFs. Verify all three appear in the invoice archive, that those whose dates fall within budget periods are linked, and that the batch summary correctly reports counts and any failures.

**Acceptance Scenarios**:

1. **Given** a zip file containing multiple valid PDFs, **When** the admin uploads it, **Then** each PDF is extracted, field extraction runs for each, and the admin sees a batch review screen listing all detected invoices with pre-filled fields.
2. **Given** the batch review screen, **When** the admin submits, **Then** each invoice is saved to the archive and linked to its budget period where one exists; the summary shows success/failure per file.
3. **Given** a zip where one file is not a PDF, **When** it is processed, **Then** non-PDF files are skipped and the admin is notified; valid PDFs in the same zip are still processed.
4. **Given** a zip containing a PDF with no readable text layer, **When** it is processed, **Then** that invoice is flagged as requiring manual field entry rather than failing the entire batch.
5. **Given** a zip file that exceeds the maximum allowed size, **When** the admin tries to upload it, **Then** they see a clear message stating the size limit and the upload is rejected before processing begins.

---

### Edge Cases

- What happens when an invoice date falls on the exact boundary between two periods (e.g. the last day of a month)?
- How does the system handle two invoices with the same invoice number in the same batch?
- What if an invoice is deleted from the archive — does the linked billed cost remain?
- What if the same PDF is uploaded twice (duplicate invoice number)?
- What happens when a zip contains more than a reasonable maximum number of PDFs (e.g. > 50)?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST automatically create a billed cost entry when an invoice is saved, if a non-archived budget period exists whose date range covers the invoice date.
- **FR-002**: System MUST record the invoice number as the vendor reference on the auto-created billed cost entry.
- **FR-003**: System MUST notify the admin when an invoice is saved but could not be linked to any budget period (no matching period, or matching budget is archived).
- **FR-004**: System MUST add an optional vendor field to the invoice record; admins MUST be able to view and edit it before saving.
- **FR-005**: System MUST attempt to extract the vendor name from uploaded PDF text and pre-fill the vendor field with an appropriate confidence indicator.
- **FR-006**: System MUST accept a zip archive as an upload input and extract all PDF files contained within it.
- **FR-007**: System MUST process each PDF in a zip batch through the same extraction pipeline used for single-file uploads.
- **FR-008**: System MUST present a batch review screen after zip extraction, allowing the admin to inspect and correct extracted fields for all invoices before saving.
- **FR-009**: System MUST report a per-file outcome summary after batch save, indicating which invoices were archived, which were linked to a budget period, and which failed.
- **FR-010**: System MUST skip non-PDF files inside a zip and notify the admin of any skipped entries.
- **FR-011**: System MUST enforce a maximum zip file size and reject uploads exceeding it with a clear user message.
- **FR-012**: System MUST allow an invoice to be saved without a vendor name; the field is optional.
- **FR-013**: When the vendor field is provided, System MUST include it in the description of the auto-created billed cost entry.
- **FR-014**: Deleting an invoice from the archive MUST NOT automatically delete its linked billed cost; the billed cost remains as an independent record.

### Key Entities

- **Invoice**: A record of an uploaded PDF invoice document. Attributes: invoice number, invoice date, total amount, vendor (optional), file reference, uploader, and a reference to any linked billed cost.
- **Billed Cost**: An actual spending entry within a budget period. Attributes: period, amount, date, description, vendor reference. Created automatically when an invoice is linked, or manually by an admin.
- **Budget Period**: A time window (monthly or quarterly) within an annual budget. Invoices are matched to periods by date range. Periods belong to a budget that may be active or archived.
- **Zip Batch**: A collection of PDF invoices packaged together for upload. Each PDF in the batch is treated as an independent invoice after extraction.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin can upload a single PDF invoice and have it appear in the correct budget period's cost list in under 30 seconds end-to-end.
- **SC-002**: At least 80% of clearly formatted PDF invoices have their vendor name extracted at medium or high confidence without manual correction.
- **SC-003**: An admin can upload a zip file of 10 invoices and complete the full batch review and save in under 3 minutes.
- **SC-004**: Zero invoices are silently lost — every PDF in a batch either results in a saved invoice or an explicit error message visible to the admin.
- **SC-005**: The budget period view reflects invoice-linked costs immediately after saving, without requiring a manual page refresh or additional admin action.

## Assumptions

- An invoice is matched to at most one budget period (the one whose date range contains the invoice date). If multiple budgets cover the same date, the most recently created active budget is preferred.
- Auto-created billed cost entries use the invoice number as the vendor reference and a standard description pattern (e.g. "Invoice {number} — {vendor}"). Admins can edit billed costs separately after creation.
- Zip files are expected to be flat archives (PDFs at the root level); nested folder structures within the zip are not required for the initial release.
- The maximum allowed zip size is 50 MB, accommodating batches of up to approximately 50 typical invoice PDFs.
- Only admins can upload invoices and manage billed costs, consistent with the existing access model.
- Batch processing is sequential (one PDF at a time); parallel processing is not required for the initial release.
