# Feature Specification: Bulk Data Export (Round-Trip)

**Feature Branch**: `005-bulk-export`
**Created**: 2026-03-05
**Status**: Draft
**Input**: User description: "I want to add export functions for the bulk import of the license assignments and the bulk import for the users. Both export functions should provide the exact same format that the import expects. This will allow me to export, then edit the file and re-import it."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Export License Assignments as CSV (Priority: P1)

An administrator wants to export all current license assignments as a CSV file that uses the exact same format as the bulk assignment import. This allows the admin to review current assignments in a spreadsheet, make edits (e.g., change tiers, update workspaces, remove rows), and re-import the modified file to apply changes in bulk.

**Why this priority**: This is the core value proposition — enabling round-trip editing of license assignments. License assignments are the most frequently bulk-managed data and have the most complex format (6 columns including optional API key and date).

**Independent Test**: Can be fully tested by triggering an export, opening the resulting CSV in a spreadsheet editor, verifying all column headers match the import format, then re-importing the unmodified file without errors.

**Acceptance Scenarios**:

1. **Given** there are active license assignments in the system, **When** an admin clicks the export assignments button, **Then** a CSV file is downloaded containing all assignments with headers: `email`, `tool`, `tier`, `workspace`, `api_key`, `assigned_at`.
2. **Given** a freshly exported assignments CSV, **When** the admin re-imports it without modifications, **Then** the import processes without format validation errors (business-rule errors like duplicates are expected and acceptable).
3. **Given** assignments exist with and without API keys, **When** the export runs, **Then** rows without API keys have an empty value in the `api_key` column, and rows with API keys include the decrypted key value.
4. **Given** the system has no license assignments, **When** the admin triggers an export, **Then** a CSV file is downloaded containing only the header row.

---

### User Story 2 - Export Users as CSV (Priority: P1)

An administrator wants to export all current users as a CSV file that uses the exact same format as the bulk user import. This allows the admin to review users, make edits (e.g., change roles, update circles, add GitHub usernames), and re-import the file.

**Why this priority**: Equal priority to assignment export — users are the other bulk-managed entity and the export format is simpler (6 columns). Together with Story 1, this completes the round-trip capability for all bulk-importable data.

**Independent Test**: Can be fully tested by triggering a user export, verifying CSV headers match the import format (`name`, `email`, `circle`, `role`, `github_username`, `profile`), and re-importing the unmodified file.

**Acceptance Scenarios**:

1. **Given** there are active users in the system, **When** an admin clicks the export users button, **Then** a CSV file is downloaded containing all users with headers: `name`, `email`, `circle`, `role`, `github_username`, `profile`.
2. **Given** a freshly exported users CSV, **When** the admin re-imports it without modifications, **Then** the import processes without format validation errors (duplicate email errors are expected and acceptable).
3. **Given** users exist with optional fields empty (no GitHub username, no profile), **When** the export runs, **Then** those fields are empty in the CSV rather than containing "null" or "undefined".
4. **Given** the system has no users, **When** the admin triggers an export, **Then** a CSV file is downloaded containing only the header row.

---

### User Story 3 - Export Actions Accessible from Import Pages (Priority: P2)

An administrator navigating to the bulk import pages (for assignments or users) can see an export button alongside the import form, making the round-trip workflow discoverable and convenient.

**Why this priority**: Without a clear UI entry point, the export feature is not discoverable. Placing it on the import pages creates a natural workflow: export → edit → re-import.

**Independent Test**: Can be tested by navigating to each import page and verifying the export button is visible and functional.

**Acceptance Scenarios**:

1. **Given** an admin navigates to the assignment import page, **When** the page loads, **Then** an "Export Current Assignments" button is visible alongside the import form.
2. **Given** an admin navigates to the user import page, **When** the page loads, **Then** an "Export Current Users" button is visible alongside the import form.
3. **Given** an admin clicks the export button, **When** the export completes, **Then** the file download begins automatically and the admin remains on the same page.

---

### Edge Cases

- What happens when exported data contains commas, quotes, or newlines in field values (e.g., workspace names)? The CSV must properly escape these using standard RFC 4180 quoting rules.
- What happens when the export file is very large (thousands of rows)? The system should handle exports up to 10,000 rows without timeout or memory issues.
- What happens when an assignment has an encrypted API key? The export must include the decrypted (original) key so that re-import works correctly.
- What happens when date values in assignments vary in timezone? Dates must be exported in the exact `YYYY-MM-DD` format the import expects.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide an export function that generates a CSV file of all license assignments using the exact column headers expected by the assignment bulk import: `email`, `tool`, `tier`, `workspace`, `api_key`, `assigned_at`.
- **FR-002**: System MUST provide an export function that generates a CSV file of all users using the exact column headers expected by the user bulk import: `name`, `email`, `circle`, `role`, `github_username`, `profile`.
- **FR-003**: Assignment export MUST resolve internal identifiers to human-readable values: user IDs to email addresses, tool IDs to tool names, tier IDs to tier names.
- **FR-004**: Assignment export MUST include decrypted API keys so that re-import produces functional assignments.
- **FR-005**: Assignment export MUST format the `assigned_at` date as `YYYY-MM-DD` to match the import's expected format.
- **FR-006**: User export MUST map the `role` field to the import-compatible values (`admin` or `viewer`).
- **FR-007**: User export MUST map the `profile` field to the import-compatible values (`boost`, `maxed`, or `indie`) or leave empty if not set.
- **FR-008**: Both export functions MUST produce valid CSV with proper escaping per RFC 4180 (quoted fields for values containing commas, quotes, or newlines).
- **FR-009**: Both export functions MUST be accessible only to authenticated administrators.
- **FR-010**: Both export functions MUST generate a downloadable file with a descriptive filename (e.g., `assignments-export-2026-03-05.csv`, `users-export-2026-03-05.csv`).
- **FR-011**: Export buttons MUST be placed on the respective bulk import pages for discoverability.
- **FR-012**: Optional/nullable fields MUST export as empty strings (not "null", "undefined", or "N/A").

### Key Entities

- **License Assignment**: Represents a user's access to a specific AI tool tier within a workspace. Key export fields: user email, tool name, tier name, workspace, API key (decrypted), assignment date.
- **User**: Represents a system user. Key export fields: name, email, circle, role, GitHub username, profile classification.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An administrator can export assignments, make no changes, and re-import the file with zero format validation errors.
- **SC-002**: An administrator can export users, make no changes, and re-import the file with zero format validation errors.
- **SC-003**: Export of 1,000 records completes and downloads within 5 seconds.
- **SC-004**: Exported CSV files open correctly in common spreadsheet applications (Excel, Google Sheets, LibreOffice Calc) without encoding or formatting issues.
- **SC-005**: 100% of exported rows pass the existing import validation schema when re-imported.

## Assumptions

- The existing bulk import format and validation schemas (from feature 004) are stable and will not change concurrently with this feature.
- API keys can be decrypted for export purposes using the existing decryption utility (inverse of the encryption used during import).
- The export will include all records regardless of status (active/inactive). If filtering is desired, it can be added as a future enhancement.
- CSV is the only export format needed (no Excel/JSON export required).
- The export is a client-initiated download (not a background job or email delivery).
