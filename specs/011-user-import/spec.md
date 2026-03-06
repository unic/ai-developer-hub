# Feature Specification: Bulk User Import with Upsert & Export

**Feature Branch**: `011-user-import`
**Created**: 2026-03-06
**Status**: Draft
**Input**: User description: "the bulk import for users should update existing users (without changing their passwords) and add new users. Updating multiple users by first exporting, then editing the exported file and then importing it again should be a valid workflow for bulk changes. The export functionality should also be available on the user overview page. Use subagents and commit often"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Export-Edit-Import Workflow for Bulk Updates (Priority: P1)

An administrator wants to update multiple users at once (e.g., reassign circles, change roles, update profiles). They navigate to the user overview page, export the current user list as a CSV file, open it in a spreadsheet editor, make changes to the relevant rows, and re-import the modified file. The system updates existing users based on email matching without altering their passwords, and reports a summary of changes made.

**Why this priority**: This is the core workflow that enables efficient bulk user management. Without upsert behavior on import, administrators must edit users one-by-one, which is impractical at scale.

**Independent Test**: Can be fully tested by exporting users, modifying fields in the CSV, re-importing, and verifying that user records are updated while passwords remain unchanged.

**Acceptance Scenarios**:

1. **Given** an administrator has exported the user list, **When** they modify a user's circle and role in the CSV and re-import it, **Then** the system updates that user's circle and role without changing their password.
2. **Given** an exported CSV contains 10 existing users and 2 new rows, **When** the administrator imports the file, **Then** 10 users are updated (preserving passwords) and 2 new users are created with the default password.
3. **Given** a CSV row has an email matching an existing user, **When** no fields have changed compared to the current record, **Then** the system skips that row and does not count it as an update.
4. **Given** an administrator imports a CSV, **When** the import completes, **Then** the system displays a summary showing counts of created users, updated users, skipped users (no changes), and failed rows with error details.

---

### User Story 2 - Export from User Overview Page (Priority: P2)

An administrator viewing the user overview page wants to quickly export the full user list without navigating to the bulk import page. An export button is available directly on the user overview page, allowing one-click CSV download.

**Why this priority**: Making export accessible from the user overview page removes friction from the export-edit-import workflow and makes the export feature discoverable where administrators naturally work.

**Independent Test**: Can be tested by navigating to the user overview page and clicking the export button, verifying a CSV file downloads with all current user data.

**Acceptance Scenarios**:

1. **Given** an administrator is on the user overview page, **When** they click the export button, **Then** a CSV file downloads containing all users with columns: name, email, circle, role, github_username, profile.
2. **Given** a non-admin user is on the user overview page, **When** they view the page, **Then** the export button is not visible.
3. **Given** the exported CSV is opened in a spreadsheet application, **When** the administrator reviews it, **Then** all fields are properly formatted and the file is compatible with common spreadsheet editors (Excel, Google Sheets, LibreOffice).

---

### User Story 3 - Add New Users via Bulk Import (Priority: P1)

An administrator needs to onboard a batch of new users. They prepare a CSV file with user details and import it. New users (those with emails not matching any existing user) are created with a default password.

**Why this priority**: This is existing core functionality that must continue working correctly alongside the new upsert behavior.

**Independent Test**: Can be tested by importing a CSV containing only new email addresses and verifying all users are created.

**Acceptance Scenarios**:

1. **Given** a CSV with 5 rows where no emails match existing users, **When** the administrator imports it, **Then** 5 new user accounts are created with the default password.
2. **Given** a CSV row is missing the required name or email field, **When** the administrator previews the import, **Then** that row is flagged with a validation error and excluded from import.
3. **Given** the CSV contains two rows with the same email address, **When** the administrator imports it, **Then** the system detects the duplicate within the file and reports an error for the duplicate row.

---

### User Story 4 - Import Preview with Update Indicators (Priority: P2)

Before committing an import, the administrator reviews a preview table that clearly distinguishes which rows will create new users versus which will update existing users. This allows the administrator to verify the intended changes before execution.

**Why this priority**: Preview with clear create/update indicators prevents accidental bulk modifications and gives administrators confidence in the import operation.

**Independent Test**: Can be tested by uploading a mixed CSV (some new, some existing emails) and verifying the preview correctly labels each row.

**Acceptance Scenarios**:

1. **Given** a CSV with a mix of new and existing users, **When** the administrator uploads the file, **Then** the preview table shows each row labeled as "New" or "Update".
2. **Given** the preview shows update rows, **When** the administrator reviews them, **Then** fields that will change are visually highlighted or indicated.
3. **Given** the preview shows validation errors on some rows, **When** the administrator reviews the preview, **Then** error rows are clearly marked and valid rows can still be imported.

---

### Edge Cases

- What happens when a CSV contains an email for an inactive user? The system updates the user's fields but does not reactivate them — status is not changed via import.
- What happens when the CSV has columns in a different order than the export? The system matches columns by header name, not position.
- What happens when the CSV contains extra columns not recognized by the system? Extra columns are silently ignored.
- What happens when the CSV uses different line endings (CRLF vs LF)? Both formats are accepted.
- What happens when an update row has an invalid value (e.g., invalid role)? That row fails validation and is reported as an error; other valid rows proceed.
- What happens when the export file is re-imported without any edits? All rows are detected as unchanged and skipped, with a summary showing zero updates.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST match imported users to existing users by email address (case-insensitive).
- **FR-002**: When an imported row matches an existing user by email, the system MUST update the user's fields (name, circle, role, github_username, profile) with the values from the CSV.
- **FR-003**: When updating an existing user, the system MUST NOT modify the user's password hash.
- **FR-004**: When updating an existing user, the system MUST NOT modify the user's status (active/inactive).
- **FR-005**: When an imported row does not match any existing user, the system MUST create a new user with a default password.
- **FR-006**: The import preview MUST indicate whether each row will result in a "New" user creation or an "Update" to an existing user.
- **FR-007**: The import summary MUST report separate counts for: users created, users updated, rows skipped (no changes), and rows failed.
- **FR-008**: An export button MUST be available on the user overview page for administrators.
- **FR-009**: The export functionality on the user overview page MUST produce the same CSV format as the existing export on the bulk import page.
- **FR-010**: The exported CSV format MUST be directly re-importable without modification (round-trip compatibility).
- **FR-011**: When an update row contains no field changes compared to the existing record, the system MUST skip that row rather than performing a no-op update.
- **FR-012**: All user updates performed via bulk import MUST be recorded in the change history with appropriate field-level change tracking.
- **FR-013**: The import preview MUST visually distinguish fields that will change for update rows.

### Key Entities

- **User**: The primary entity being imported/exported. Matched by email (unique identifier). Fields: name, email, circle, role, github_username, profile, status, passwordHash.
- **Import Operation**: A logical grouping of rows being processed. Produces a summary with counts of created, updated, skipped, and failed rows.
- **Change History Entry**: An audit record created for each field-level change made during a bulk update.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Administrators can update 100 users in under 5 minutes using the export-edit-import workflow (compared to editing each user individually).
- **SC-002**: Re-importing an unmodified export file results in zero creates, zero updates, and all rows reported as skipped.
- **SC-003**: Existing user passwords remain unchanged after any bulk import operation that updates their records.
- **SC-004**: 100% of field-level changes from bulk import are recorded in the change history audit trail.
- **SC-005**: The export button on the user overview page is discoverable without navigating to the import page.
- **SC-006**: Import preview correctly identifies all rows as "New" or "Update" with 100% accuracy before the import is executed.

## Assumptions

- The default password for new users created via bulk import remains "changeme123" (consistent with existing behavior).
- Email is the unique identifier for matching — it cannot be changed via bulk import (if a CSV row has a new email, it creates a new user).
- The export CSV does not include the password column, status column, or internal ID — these are system-managed fields not editable via import.
- Column matching in the CSV is done by header name (case-insensitive), making column order irrelevant.
- The existing CSV parsing (client-side) and export (server-side) infrastructure is reused and extended rather than replaced.
- Status is not importable — administrators must activate/deactivate users through the existing individual user management interface.
