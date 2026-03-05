# Feature Specification: Bulk License Import, API Key Management & User Profile Extension

**Feature Branch**: `004-bulk-license-import`
**Created**: 2026-03-05
**Status**: Draft
**Input**: User description: "I want to add a bulk import for the license assignments. The import file will provide the email address to link it to the user, a tool, the tier of the tool, the workspace, and an API key for the users that have one. Also, the date of assignment will be provided in the import file. The API key should also be added to the assignment detail page. The user profile should be extended with a profile field. Currently, there's three profiles available, Boost, Maxed, and Indie."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bulk Import License Assignments via CSV (Priority: P1)

An admin needs to onboard a large group of users to their AI tool licenses all at once. Instead of creating each assignment individually, the admin uploads a CSV file containing each user's email address, the tool name, the tier, the workspace, an optional API key, and the date of assignment. The system validates each row, shows a preview with any errors highlighted, and imports all valid rows in a single action.

**Why this priority**: This is the core feature request and the highest-value workflow improvement — enabling admins to assign many licenses at once rather than one at a time, directly reducing manual effort.

**Independent Test**: Can be fully tested by uploading a CSV with a mix of valid and invalid rows, verifying the preview shows correct validation feedback, and confirming that only valid rows are imported as license assignments linked to the correct users.

**Acceptance Scenarios**:

1. **Given** an admin is on the bulk import page, **When** they upload a CSV with valid rows (email matching an existing user, known tool name, known tier for that tool, workspace, optional API key, valid date), **Then** the system previews all rows with a "Valid" status and allows import.
2. **Given** a CSV row references an email not found in the system, **When** the admin previews the file, **Then** that row is marked invalid with a message indicating the user was not found.
3. **Given** a CSV row references a tool name or tier name that does not exist, **When** the admin previews, **Then** that row is marked invalid with a descriptive error.
4. **Given** the admin clicks "Import", **When** all valid rows are processed, **Then** license assignments are created with the correct tool, tier, workspace, API key (encrypted), and assignment date from the file.
5. **Given** invalid rows exist in the preview, **When** the admin imports, **Then** only valid rows are imported; invalid rows are skipped and a summary reports how many succeeded and how many failed.
6. **Given** a CSV row contains an assignment date, **When** that row is imported, **Then** the assignment's recorded date matches the date from the CSV file rather than the current date.
7. **Given** a row does not include an API key column value, **When** imported, **Then** the assignment is created without an API key.

---

### User Story 2 - Manage API Key on Assignment Detail Page (Priority: P2)

An admin viewing an individual license assignment needs to be able to add or update the API key directly on the assignment detail page, not just view it. This allows corrections and late additions without needing to re-import.

**Why this priority**: Complements the bulk import by providing a fallback for individual API key corrections. High value for operational flexibility.

**Independent Test**: Can be fully tested by navigating to an existing assignment, adding or replacing its API key via the detail page form, saving, and verifying the masked key appears and can be revealed.

**Acceptance Scenarios**:

1. **Given** an admin is viewing an assignment that has no API key, **When** they enter an API key in the API key field and save, **Then** the assignment shows the masked API key and the reveal/copy controls become available.
2. **Given** an admin is viewing an assignment that already has an API key, **When** they enter a new value in the API key field and save, **Then** the API key is updated and the newly set key can be revealed.
3. **Given** a viewer (non-admin) is viewing an assignment, **When** they view the detail page, **Then** the API key edit field is not visible (read-only masked view only, if a key exists).
4. **Given** an admin clears the API key field and saves, **Then** the API key is removed from the assignment.

---

### User Story 3 - User Profile Field (Priority: P3)

Each user record should carry a "profile" classification that categorizes the user's license tier context. Admins can set or update this profile (Boost, Maxed, or Indie) on the user detail page. The profile is also available in the bulk user import and displayed on the user's profile page.

**Why this priority**: A data enrichment feature that supports reporting and filtering. Lower urgency than import and API key management.

**Independent Test**: Can be fully tested by editing a user's profile field to each of the three values and verifying the value is saved, displayed, and available in the users list.

**Acceptance Scenarios**:

1. **Given** an admin is editing a user, **When** they select a profile value (Boost, Maxed, or Indie) and save, **Then** the user's profile field is updated and displayed on the user's detail and list views.
2. **Given** a user has no profile set, **When** displayed in the users list or detail page, **Then** the profile field shows a neutral/empty state (e.g., "—") rather than an error.
3. **Given** a new user is created, **When** no profile is selected, **Then** the profile field defaults to no value (optional field).
4. **Given** the bulk user import CSV includes a profile column, **When** a valid profile value is provided, **Then** the imported user has the correct profile assigned.
5. **Given** the bulk user import includes an unrecognized profile value, **When** previewed, **Then** that row is marked invalid with a message indicating the profile value is not one of Boost, Maxed, or Indie.

---

### Edge Cases

- What happens when the CSV uses a different date format (e.g., MM/DD/YYYY vs YYYY-MM-DD)? The system should reject unrecognized date formats with a clear per-row validation error.
- What happens when the same user+tool combination already has an active assignment? The import row should be flagged as a conflict and skipped, with an appropriate error message.
- What happens when the CSV file is empty or contains only headers? The system should show an informative message that no rows were found to import.
- What happens when the API key field in the CSV is blank for some rows? Those rows import successfully without an API key.
- What happens when the CSV contains a large number of rows (e.g., 500+)? The system should handle large files gracefully; if a practical batch limit applies, it must be communicated to the user before upload.
- What happens when an admin updates a user's profile to the same value already set? The save should succeed silently (no error, no spurious change history entry).
- What happens if a database error occurs mid-import (e.g., row 30 of 50 fails)? Already-committed rows remain; the failed row is reported in the summary. The admin can correct and re-import the failed rows.

## Requirements *(mandatory)*

### Functional Requirements

**Bulk License Assignment Import**

- **FR-001**: The system MUST provide a dedicated bulk import page for license assignments, accessible to admins only.
- **FR-002**: The import page MUST accept a CSV file with columns: `email`, `tool`, `tier`, `workspace`, `api_key` (optional), `assigned_at` (date).
- **FR-003**: The system MUST validate each CSV row before import and display a preview table showing each row with a "Valid" or error status.
- **FR-004**: Validation MUST check that the email matches an existing user, the tool name matches a known active tool, the tier name matches an active tier for that tool, and the `assigned_at` date is parseable.
- **FR-005**: The system MUST support date format YYYY-MM-DD for the `assigned_at` column and reject rows with unrecognized formats.
- **FR-006**: Upon import, the system MUST create license assignments only for valid rows, skipping invalid rows. Each row is committed individually (best-effort); a database failure on one row does not roll back previously committed rows.
- **FR-007**: After import, the system MUST display a summary showing how many assignments were created, how many were skipped (validation errors), and how many failed (database errors).
- **FR-008**: When a CSV row includes an API key, the system MUST store it encrypted, consistent with the existing API key encryption approach.
- **FR-009**: The system MUST flag rows where the user+tool combination already has an active assignment, treating them as invalid with a conflict error message.
- **FR-010**: The import MUST use the `assigned_at` date from the CSV as the assignment's recorded date rather than defaulting to the current timestamp.
- **FR-010a**: The import MUST auto-populate the assignment cost from the matched tier's current monthly cost; the CSV does not include a cost column.

**API Key Management on Assignment Detail**

- **FR-011**: The assignment detail page MUST allow admins to add or update the API key for an assignment directly on the page.
- **FR-012**: The assignment detail page MUST allow admins to clear/remove the API key from an assignment.
- **FR-013**: API key edits on the detail page MUST encrypt the key before storing it, consistent with existing security practices.
- **FR-014**: Non-admin users MUST NOT see the API key edit controls; they may only see the masked key if one exists.

**User Profile Field**

- **FR-015**: The user data model MUST include a new optional `profile` field with allowed values: `Boost`, `Maxed`, `Indie`.
- **FR-016**: The user detail page and the new user creation form MUST both display and allow admins to set/edit the `profile` field via a dropdown selector.
- **FR-017**: The users list MUST display the `profile` value for each user where set.
- **FR-018**: The bulk user import CSV MUST support an optional `profile` column; valid values are `Boost`, `Maxed`, `Indie` (case-insensitive matching acceptable).
- **FR-019**: Rows in the bulk user import with an unrecognized profile value MUST be marked invalid with a descriptive error.

### Key Entities

- **License Assignment**: Represents the allocation of a specific tool tier to a user. Key attributes: user (looked up by email during import), tool (looked up by name), tier (looked up by name within tool), workspace, API key (optional, encrypted), assignment date, status.
- **User Profile**: A classification attribute on a user record. Allowed values: Boost, Maxed, Indie. Optional — not all users require a profile set.
- **Import Row**: A single record from the CSV file during the import preview phase. Has a validity status and an optional error message. Not persisted — used only during the import workflow.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin can import 50 license assignments from a CSV in under 30 seconds end-to-end (upload, preview, confirm, complete).
- **SC-002**: 100% of import rows are correctly validated before any data is written — no invalid row results in a created assignment.
- **SC-003**: An admin can add or update an API key on an individual assignment detail page in under 3 user interactions (click edit field, type key, save).
- **SC-004**: All three user profile values (Boost, Maxed, Indie) are selectable and persistable on the user detail and create/edit forms.
- **SC-005**: The bulk license import skips rows with duplicate active assignments and reports the conflict clearly, with zero silent failures.
- **SC-006**: Profile values set via bulk user import match the values visible on the user detail page with 100% accuracy.

## Clarifications

### Session 2026-03-05

- Q: How should cost_at_assignment_cents be determined during bulk import (CSV has no cost column)? → A: Auto-populate from the tier's current monthly cost at time of import.
- Q: Should the profile field appear on the new user creation form (not just edit)? → A: Yes, include profile dropdown on both the new user form and the edit form.
- Q: How should the system handle partial database failures during import? → A: Best-effort — commit each row individually; report which rows succeeded and which failed after completion.

## Assumptions

- Tool names and tier names in the CSV are matched case-insensitively against existing records; if no match is found, the row is invalid.
- The API key column in the license import CSV is optional per row — rows without a value create assignments without an API key.
- The `assigned_at` date in the CSV represents the historical date the license was assigned; it does not affect the system-managed `createdAt` timestamp.
- The profile field is optional — existing users without a profile set are unaffected until an admin explicitly assigns one.
- Bulk license import is restricted to admin users, consistent with the existing bulk user import restriction.
- The existing encrypted API key storage mechanism is reused for imported API keys without modification.
- The assignment detail API key edit replaces the full key value; there is no partial-edit or append mode.
