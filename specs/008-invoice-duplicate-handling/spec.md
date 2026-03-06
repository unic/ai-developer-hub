# Feature Specification: Invoice Duplicate Handling & Amount Display

**Feature Branch**: `008-invoice-duplicate-handling`
**Created**: 2026-03-06
**Status**: Draft
**Input**: User description: "Invoice uploading should be handled better. Duplicate invoices should be recognized by the invoice number. Duplicate invoices can be marked that they will be skipped when they are part of a bulk upload. For single uploads you should be able to select if you want to skip or overwrite the existing invoice and the referred entry for the budgets. The detected invoice amount should be displayed in dollars and not in cents."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Duplicate Detection on Single Upload (Priority: P1)

An admin uploads a single PDF invoice. After extraction, the system checks whether an invoice with the same invoice number already exists. If a duplicate is found, the admin is presented with a clear choice: skip (cancel the upload) or overwrite (replace the existing invoice record and its linked billed cost entry in the budget). The admin makes an informed decision before anything is saved.

**Why this priority**: Duplicate invoices corrupt budget tracking by double-counting costs. Giving admins explicit control over how duplicates are handled is the most critical improvement to upload reliability.

**Independent Test**: Upload an invoice with an invoice number that already exists in the archive. Verify the system detects the duplicate, presents skip/overwrite options, and correctly executes the chosen action.

**Acceptance Scenarios**:

1. **Given** an invoice with number "INV-100" already exists in the archive, **When** the admin uploads a new PDF and the extracted invoice number is "INV-100", **Then** the system displays a duplicate warning showing the existing invoice details (number, date, amount, vendor) and offers "Skip" and "Overwrite" options.
2. **Given** a duplicate is detected and the admin chooses "Skip", **When** the action is confirmed, **Then** the uploaded PDF is removed from storage and no changes are made to the existing invoice or its linked billed cost.
3. **Given** a duplicate is detected and the admin chooses "Overwrite", **When** the action is confirmed, **Then** the existing invoice record is updated with the new PDF, date, amount, and vendor; the previously linked billed cost entry is also updated to reflect the new amount and date; and the old PDF file is removed from storage.
4. **Given** the existing duplicate invoice has a linked billed cost, **When** the admin chooses "Overwrite", **Then** the linked billed cost amount, date, and description are updated to match the new invoice data.
5. **Given** the existing duplicate invoice has no linked billed cost (e.g. no matching budget period existed at original upload time), **When** the admin overwrites it, **Then** the system attempts to link to a budget period using the new invoice date, following the same auto-link logic as a fresh upload.
6. **Given** the extracted invoice number does not match any existing invoice, **When** the admin submits the form, **Then** the invoice is saved normally with no duplicate prompt.

---

### User Story 2 - Duplicate Handling in Bulk Upload (Priority: P2)

An admin uploads a zip file containing multiple PDF invoices. During the batch review screen, any invoice whose extracted invoice number matches an existing record in the archive is flagged as a duplicate. Duplicates are pre-marked to be skipped. The admin can review the flags before submitting. On submission, flagged duplicates are skipped and the remaining invoices are saved normally.

**Why this priority**: Bulk uploads are common during monthly reconciliation. Without duplicate handling, re-uploading a batch that partially overlaps with previous uploads creates duplicate billed cost entries. This story depends on P1's detection logic.

**Independent Test**: Upload a zip containing 5 PDFs, 2 of which have invoice numbers matching existing records. Verify the batch review screen flags the 2 duplicates, that they are skipped on save, and the other 3 are processed normally.

**Acceptance Scenarios**:

1. **Given** a zip file is uploaded and processed, **When** the batch review screen is displayed, **Then** each invoice whose number matches an existing record is visually marked as a duplicate with a "Skip" indicator.
2. **Given** duplicates are flagged on the batch review screen, **When** the admin submits the batch, **Then** flagged duplicates are not saved to the archive and their uploaded PDFs are cleaned up from storage.
3. **Given** a batch contains both duplicate and new invoices, **When** the admin submits, **Then** only non-duplicate invoices are saved and linked to budget periods; the outcome summary clearly distinguishes saved, skipped (duplicate), and failed invoices.
4. **Given** two invoices within the same zip batch share the same invoice number, **When** the batch review screen is shown, **Then** the second occurrence is flagged as a within-batch duplicate so the admin can resolve it.
5. **Given** all invoices in a batch are duplicates, **When** the admin submits, **Then** none are saved and the summary reports all were skipped due to duplication.

---

### User Story 3 - Display Invoice Amount in Dollars (Priority: P3)

When an admin uploads an invoice (single or bulk), the extracted amount is displayed in the review form as a dollar value (e.g. "$125.00") rather than raw cents (e.g. "12500"). The underlying storage continues to use cents for precision, but the user-facing input and display uses dollars with two decimal places.

**Why this priority**: Displaying amounts in cents is confusing and error-prone for admins. This is a straightforward usability improvement that does not depend on the duplicate handling stories.

**Independent Test**: Upload a PDF invoice. Verify the amount field shows a dollar value (e.g. "125.00") rather than cents. Edit the value, save, and confirm the correct cent value is stored in the database.

**Acceptance Scenarios**:

1. **Given** the extraction returns an amount of 12500 cents, **When** the form is displayed, **Then** the amount field shows "125.00" with a dollar sign label or prefix.
2. **Given** the admin edits the amount field to "250.50", **When** the invoice is saved, **Then** the database stores 25050 cents.
3. **Given** the extraction returns a null amount, **When** the form is displayed, **Then** the amount field is empty with an appropriate placeholder (e.g. "0.00") indicating dollars, not cents.
4. **Given** a bulk upload batch review screen, **When** amounts are displayed per invoice row, **Then** all amounts are shown in dollars, not cents.

---

### Edge Cases

- What happens when the admin edits the invoice number in the form to match an existing record (duplicate not detected at extraction time but present at save time)?
- How does the system handle an overwrite when the new invoice date falls in a different budget period than the original?
- What if the admin enters a dollar amount with more than two decimal places (e.g. "125.005")?
- What happens when overwriting an invoice whose linked billed cost was manually edited after the original auto-link?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST check the invoice number against existing records after extraction and before saving, for both single and bulk uploads.
- **FR-002**: For single uploads with a detected duplicate, the system MUST present the admin with the existing invoice details and offer explicit "Skip" and "Overwrite" options.
- **FR-003**: When "Skip" is chosen for a single upload, the system MUST delete the uploaded PDF from storage and make no changes to the existing record.
- **FR-004**: When "Overwrite" is chosen for a single upload, the system MUST update the existing invoice record (PDF reference, date, amount, vendor) and update or create the linked billed cost entry accordingly.
- **FR-005**: When overwriting, the system MUST delete the old PDF file from storage after the new record is saved.
- **FR-006**: For bulk uploads, the system MUST flag duplicate invoices on the batch review screen with a visual indicator.
- **FR-007**: Duplicate invoices in bulk uploads MUST be pre-marked to be skipped; the admin can review but does not need to take action for duplicates to be excluded.
- **FR-008**: The batch outcome summary MUST separately report saved, skipped (duplicate), and failed invoices.
- **FR-009**: The system MUST detect within-batch duplicates (two invoices in the same zip with the same invoice number) and flag the second occurrence.
- **FR-010**: The invoice amount MUST be displayed to the admin in dollars (with two decimal places) on all upload and review forms, not in raw cents.
- **FR-011**: The system MUST convert dollar input to integer cents before storing, using standard rounding (round half up) for sub-cent values.
- **FR-012**: The underlying database storage for amounts MUST remain in integer cents to preserve precision and consistency with existing budget data.
- **FR-013**: When overwriting an invoice whose date maps to a different budget period than the original, the system MUST move the linked billed cost to the correct new period (or create a new one and delete the old).

### Key Entities

- **Invoice**: Existing entity with invoice number as the duplicate-detection key. No new attributes needed; overwrite updates existing fields (amount, date, vendor, blob references).
- **Billed Cost**: Existing entity linked from an invoice. On overwrite, the linked billed cost is updated or re-created in the correct budget period.
- **Duplicate Flag (transient)**: A client-side marker on the batch review screen indicating an invoice is a duplicate. Not persisted; used only during the upload review flow.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero duplicate billed cost entries are created when re-uploading invoices with the same invoice number, whether via single or bulk upload.
- **SC-002**: Admins can resolve a single-upload duplicate (skip or overwrite) in under 10 seconds from the moment the duplicate warning appears.
- **SC-003**: In a bulk upload of 20 invoices where 5 are duplicates, the admin completes the review and save in under 2 minutes, with all 5 duplicates correctly skipped.
- **SC-004**: 100% of invoice amounts displayed on upload and review screens show dollar values with two decimal places, not raw cent integers.
- **SC-005**: Overwriting an invoice correctly updates both the invoice record and its linked billed cost entry (or creates a new link if the period changed) with no orphaned or stale data.

## Assumptions

- Invoice number is the sole key for duplicate detection. Two invoices with different numbers but identical content are treated as distinct records.
- The "Overwrite" action for single uploads is an update-in-place: the existing invoice row is modified rather than deleted and re-created. This preserves the original invoice ID and any audit history references.
- When overwriting causes a period change for the linked billed cost, the old billed cost is deleted and a new one is created in the correct period, since billed costs are scoped to a specific period.
- Bulk upload does not offer an "Overwrite" option per duplicate — only skip. This keeps the batch flow simple and avoids complex per-row conflict resolution. Admins can re-upload individual invoices with overwrite if needed.
- The dollar-to-cents conversion rounds to the nearest cent using standard arithmetic rounding. Inputs with more than two decimal places are rounded before storage.
- All existing invoice list views and detail screens that currently show amounts in cents will also be updated to display dollars for consistency.
