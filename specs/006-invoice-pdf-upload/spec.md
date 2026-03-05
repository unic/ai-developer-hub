# Feature Specification: Invoice PDF Upload & Auto-Processing

**Feature Branch**: `006-invoice-pdf-upload`
**Created**: 2026-03-05
**Status**: Draft
**Input**: User description: "Instead of manually adding all invoice data, I want to be able to upload an invoice PDF file and have the invoice automatically processed and stored for archive functionality. It should automatically find the correct invoice number, assign the correct date, and the correct Amount."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Upload and Auto-Process Invoice PDF (Priority: P1)

An administrator uploads a PDF invoice file. The system automatically extracts the invoice number, date, and total amount from the document. The extracted data is presented for review and confirmation before being saved to the invoice archive.

**Why this priority**: This is the core workflow the feature is built around. Without it, no other functionality exists. It directly eliminates manual data entry and delivers immediate time savings.

**Independent Test**: Can be fully tested by uploading a real invoice PDF and verifying that extracted fields are accurately pre-populated and saveable to the archive.

**Acceptance Scenarios**:

1. **Given** a valid PDF invoice, **When** the user uploads it, **Then** the system extracts and displays the invoice number, date, and total amount within 10 seconds, pre-populating a confirmation form.
2. **Given** a pre-populated confirmation form, **When** the user reviews and confirms, **Then** the invoice record is saved to the archive with the PDF attached and a success notification is shown.
3. **Given** a successfully archived invoice, **When** the user views the invoice archive, **Then** the newly added invoice appears with all extracted fields correct.

---

### User Story 2 - Correct Extraction Errors Before Saving (Priority: P2)

When the system cannot confidently extract one or more fields (e.g., the invoice number is ambiguous or missing), the user is shown which fields need manual input. The user corrects or fills in the missing data and saves.

**Why this priority**: Automatic extraction is imperfect. Without the ability to correct errors before saving, the archive would contain inaccurate records. This story ensures data integrity.

**Independent Test**: Can be tested by uploading a PDF with a partially readable invoice number and verifying that the relevant field is empty or flagged, allowing the user to enter the value manually before saving.

**Acceptance Scenarios**:

1. **Given** a PDF where the invoice number cannot be extracted, **When** the system processes the file, **Then** the invoice number field is left blank (or flagged) while other successfully extracted fields are pre-populated.
2. **Given** a partially filled confirmation form, **When** the user corrects missing fields and confirms, **Then** the invoice is saved with the user-provided values.
3. **Given** a required field is left empty, **When** the user attempts to save, **Then** the system shows a validation error and prevents saving until the field is filled.

---

### User Story 3 - View and Download Archived Invoices (Priority: P3)

Users can browse previously archived invoices, view their details, and download the original PDF file for each entry.

**Why this priority**: The archive's value depends on being able to retrieve stored invoices. Without retrieval, the archive is a black box.

**Independent Test**: Can be tested independently by viewing the invoice list and downloading a previously uploaded PDF.

**Acceptance Scenarios**:

1. **Given** invoices exist in the archive, **When** the user opens the invoice archive page, **Then** all invoices are listed with invoice number, date, and amount visible.
2. **Given** an archived invoice with an attached PDF, **When** the user clicks to download, **Then** the original PDF file is downloaded to their device.

---

### Edge Cases

- What happens when the uploaded file is not a valid PDF (e.g., image disguised as PDF, corrupted file)?
- What happens when the PDF has no readable text (scanned image-only PDF)?
- What happens when multiple invoice totals appear (e.g., subtotal, tax, grand total)?
- How does the system handle a duplicate invoice number already present in the archive?
- What happens when the PDF file size exceeds a reasonable upload limit?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow users with appropriate permissions to upload a PDF file as an invoice.
- **FR-002**: System MUST automatically extract the invoice number, invoice date, and total amount from the uploaded PDF.
- **FR-003**: System MUST present extracted field values in an editable confirmation form before saving to the archive.
- **FR-004**: System MUST clearly indicate which fields could not be extracted with confidence, prompting the user to provide values manually.
- **FR-005**: System MUST validate that all required fields (invoice number, date, amount) are present before allowing the invoice to be saved.
- **FR-006**: System MUST store the original PDF file alongside the extracted invoice record in the archive.
- **FR-007**: System MUST reject non-PDF file uploads with a clear error message.
- **FR-008**: System MUST warn the user if an invoice number being saved already exists in the archive, allowing them to proceed or cancel.
- **FR-009**: System MUST display a list of archived invoices showing invoice number, date, and amount.
- **FR-010**: System MUST allow users to download the original PDF for any archived invoice.

### Key Entities

- **Invoice**: Represents a single invoice record. Key attributes: unique invoice number, invoice date, total amount, upload timestamp, uploader identity.
- **Invoice File**: The original PDF binary associated with an invoice. Linked to an Invoice record; preserved for download and audit purposes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 80% of standard invoice PDFs with machine-readable text have all three fields (invoice number, date, amount) correctly extracted without user correction.
- **SC-002**: Users can complete the full upload-to-archive workflow (upload, review, confirm) in under 60 seconds for a typical invoice.
- **SC-003**: Users can locate any archived invoice within 3 clicks from the main navigation.
- **SC-004**: Zero invoices are saved to the archive with missing required fields.
- **SC-005**: The original PDF is always retrievable after archiving — no data loss occurs during the storage process.

## Assumptions

- Only authenticated users with at least administrator-level access can upload and archive invoices, consistent with the existing permissions model.
- "Amount" refers to the grand total (final payable amount) on the invoice, not subtotals or line-item amounts.
- Invoices are expected to be single-document PDFs (one invoice per file); multi-invoice PDFs are out of scope for the initial version.
- Scanned (image-only) PDFs that contain no machine-readable text are treated as unextractable; the user must enter all fields manually in that case.
- Monetary amounts are stored as integers in cents, consistent with the project-wide convention.
- The invoice archive is a standalone section of the application; integration with existing budget periods or billed costs records is out of scope unless specified separately.
