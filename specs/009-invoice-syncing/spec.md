# Feature Specification: Invoice-to-Budget Period Sync

**Feature Branch**: `009-invoice-syncing`
**Created**: 2026-03-06
**Status**: Draft
**Input**: User description: "For the invoice management, I want to add a sync functionality which goes through all the uploaded invoices and tries to match them to the budget periods again. For existing budget periods it should verify them, for missing it should try to match them to new ones and create an entry on the budget if necessary. This must work for the current active budget as well as for budgets from the past. The goal of this feature is to sync and fix wrong and missing budget period assignments with invoices to get into a correct state again."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run Full Invoice Sync (Priority: P1)

As a budget administrator, I want to trigger a sync operation that scans all uploaded invoices and attempts to match each one to the correct budget period, so that invoices with missing or incorrect budget links are automatically corrected.

**Why this priority**: This is the core value of the feature — without the sync engine, nothing else works. It directly addresses the problem of invoices that were uploaded before a budget existed, or invoices that landed in the wrong period.

**Independent Test**: Can be fully tested by uploading several invoices (some with links, some without), then triggering sync and verifying that unlinked invoices gain correct budget period links and mismatched invoices are corrected.

**Acceptance Scenarios**:

1. **Given** invoices exist that have no linked budget period, **When** sync is triggered, **Then** the system attempts to find a matching budget period for each unlinked invoice based on its invoice date, and creates a billed cost entry linking the invoice to the correct period.
2. **Given** invoices exist that are linked to a budget period, **When** sync is triggered, **Then** the system verifies that the linked period's date range still covers the invoice date; if it does, no change is made.
3. **Given** an invoice is linked to a period that does not cover its invoice date, **When** sync is triggered, **Then** the system removes the old billed cost link, finds the correct period, creates a new billed cost entry, and updates the invoice link.
4. **Given** an invoice date does not fall within any budget period (active or archived), **When** sync is triggered, **Then** the invoice remains unlinked and is reported as unresolvable in the sync results.
5. **Given** budgets exist with both "active" and "archived" status, **When** sync is triggered, **Then** the system considers periods from all budgets regardless of status when matching invoice dates.

---

### User Story 2 - View Sync Results Summary (Priority: P1)

As a budget administrator, after running a sync, I want to see a clear summary of what changed, what was verified, and what could not be resolved, so that I can understand the current state and take manual action where needed.

**Why this priority**: Without visibility into sync results, the administrator cannot trust the operation or know what still needs attention. This is essential for the sync to be useful.

**Independent Test**: Can be tested by running sync on a mixed set of invoices and verifying the results summary accurately categorizes each invoice into verified, newly linked, corrected, or unresolvable.

**Acceptance Scenarios**:

1. **Given** sync has completed, **When** the results are displayed, **Then** the summary shows counts for: verified (already correct), newly linked, corrected (re-linked to different period), and unresolvable (no matching period).
2. **Given** sync results are displayed, **When** the administrator reviews the details, **Then** each affected invoice shows: invoice number, invoice date, amount, vendor, previous state (unlinked / old period label), and new state (new period label / still unlinked).
3. **Given** some invoices could not be matched, **When** the administrator views unresolvable items, **Then** a clear reason is shown (e.g., "No budget period covers date 2025-03-15").

---

### User Story 3 - Sync Entry Point in Invoice Management (Priority: P2)

As a budget administrator, I want to access the sync functionality from the invoice management area through a clearly labeled action, so that I can easily find and use it when needed.

**Why this priority**: The sync must be discoverable and accessible. Without a clear entry point, users may not know the feature exists. Lower priority than the engine and results because the entry point is a simple UI element.

**Independent Test**: Can be tested by navigating to the invoice management section and verifying the sync action is visible and triggers the sync operation.

**Acceptance Scenarios**:

1. **Given** the administrator is on the invoice listing page, **When** they look at the page actions, **Then** a "Sync Invoices" button or action is visible.
2. **Given** the administrator clicks "Sync Invoices", **When** the sync begins, **Then** a progress indicator shows that the operation is running.
3. **Given** a sync is already in progress, **When** the administrator attempts to start another sync, **Then** the system prevents concurrent syncs and informs the user.

---

### User Story 4 - Dry Run Preview (Priority: P3)

As a budget administrator, I want to preview what the sync would change before committing the changes, so that I can review proposed corrections and avoid unintended modifications.

**Why this priority**: Provides a safety net for administrators who want to review changes before applying them. Valuable but not essential for the core sync to function.

**Independent Test**: Can be tested by triggering a dry run, reviewing the proposed changes, and verifying that no actual database changes occur until the administrator confirms.

**Acceptance Scenarios**:

1. **Given** the administrator selects a dry run option, **When** the preview completes, **Then** the system displays proposed changes (same format as sync results) without modifying any data.
2. **Given** a dry run preview is displayed, **When** the administrator confirms the changes, **Then** the system applies the proposed changes and shows the final results.
3. **Given** a dry run preview is displayed, **When** the administrator cancels, **Then** no changes are made and the administrator returns to the invoice listing.

---

### Edge Cases

- What happens when an invoice date falls within overlapping budget periods from different fiscal years? The system matches to the most recently created budget's period, consistent with existing behavior.
- What happens when a linked billed cost was manually created (not via invoice upload) and shares the same period? The sync only modifies billed costs that are directly linked from an invoice record; manually created billed costs are not affected.
- What happens when the same invoice date matches periods in both an active and an archived budget? The system prefers the active budget's period. If no active budget period matches, it falls back to archived budgets.
- What happens if the sync encounters a database error mid-operation? Each invoice is processed independently; failures on one invoice do not prevent others from being synced. Failed invoices are reported in the results.
- What happens with duplicate invoices (same invoice number)? Each invoice record is processed individually based on its own invoice date. Duplicate detection is a separate concern handled by feature 008.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST scan all invoices in the database when sync is triggered, regardless of their current link status.
- **FR-002**: For each unlinked invoice (no billed cost association), the system MUST attempt to find a budget period whose date range contains the invoice date and create a billed cost entry linking them.
- **FR-003**: For each linked invoice, the system MUST verify that the linked budget period's date range still covers the invoice date.
- **FR-004**: If a linked invoice's date does not fall within its currently linked period, the system MUST remove the old billed cost, find the correct period, create a new billed cost, and update the invoice link.
- **FR-005**: The system MUST consider budget periods from all budgets (both active and archived) when matching, preferring active budget periods over archived ones for the same date range.
- **FR-006**: The billed cost entry created during sync MUST include the invoice number in the description, the vendor (if available), the invoice amount, and the invoice date, consistent with the format used during upload.
- **FR-007**: The system MUST produce a results summary categorizing each invoice as: verified, newly linked, corrected, or unresolvable.
- **FR-008**: The system MUST process each invoice independently so that a failure on one invoice does not block processing of others.
- **FR-009**: The system MUST prevent concurrent sync operations from running simultaneously.
- **FR-010**: The system MUST provide a dry run mode that calculates proposed changes without modifying data.
- **FR-011**: When updating an existing billed cost link (correction), the system MUST delete the old billed cost record and create a new one in the correct period within a single transaction per invoice.

### Key Entities

- **Invoice**: An uploaded document with an invoice number, date, amount, vendor, and an optional link to a billed cost. The sync operates on all invoice records.
- **Billed Cost**: A cost entry within a budget period. Created or replaced by the sync when linking an invoice to a period. Contains amount, date, description, and vendor reference.
- **Budget Period**: A date-bounded subdivision of an annual budget (monthly or quarterly). The sync matches invoices to periods based on date containment (start date inclusive, end date exclusive).
- **Annual Budget**: A fiscal year budget that owns budget periods. May be active or archived. The sync considers periods from all budgets.
- **Sync Result**: A transient summary produced after sync completion, categorizing each processed invoice by outcome (verified, newly linked, corrected, unresolvable).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After running sync, 100% of invoices whose dates fall within a budget period are correctly linked to that period.
- **SC-002**: Sync results summary accurately reflects all changes made, with zero discrepancies between reported and actual state.
- **SC-003**: The sync operation completes within 30 seconds for up to 500 invoices.
- **SC-004**: Administrators can review sync results and identify unresolvable invoices in under 1 minute.
- **SC-005**: No data is lost or corrupted during sync — existing correct links are preserved, and only incorrect or missing links are modified.
- **SC-006**: The dry run preview matches the actual sync outcome when subsequently applied (assuming no data changes between dry run and execution).

## Assumptions

- Budget periods do not have gaps within a fiscal year; every date within a fiscal year's range falls into exactly one period for that budget.
- The existing date containment rule (start date inclusive, end date exclusive) is the correct matching logic and will be extended to also consider archived budgets.
- Invoice dates are always valid and in YYYY-MM-DD format (enforced by existing validation).
- The sync is triggered manually by an administrator; there is no automatic/scheduled sync.
- When multiple budgets (active + archived) have periods covering the same date, the active budget takes priority. Among archived budgets, the most recently created one takes priority.
