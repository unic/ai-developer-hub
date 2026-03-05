# Feature Specification: Enhance Core Features

**Feature Branch**: `003-enhance-core-features`
**Created**: 2026-03-03
**Status**: Draft
**Input**: User description: "Improve basic functions — login for unauthenticated users, editable tiers with history, editable license assignments with retrospective dates and meta fields, budget billed costs tracking, rename Department to Circle (Holacracy)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Unauthenticated User Login & Role-Based Sidebar (Priority: P1)

When an unauthenticated visitor navigates to the application, they see a sidebar with a prominent login option rather than no navigation at all. The sidebar provides the application branding and a clear call-to-action to log in. After authentication, the sidebar adapts to the user's role: administrators see the full navigation (Dashboard, Tools, Users, Assignments, Budget, Reports, Settings), while viewer-role users see a minimal set (Dashboard, Assignments for their own records, Settings).

**Why this priority**: Without authentication access, no other feature in the application is usable. The sidebar is the primary navigation mechanism — hiding it entirely from unauthenticated users leaves them stranded. Role-based sidebar visibility ensures viewers aren't overwhelmed with sections they cannot use.

**Independent Test**: Can be fully tested by opening the application in an incognito browser window to verify the unauthenticated sidebar with login, then logging in as a viewer to verify the limited sidebar, and as an admin to verify the full sidebar.

**Acceptance Scenarios**:

1. **Given** a visitor is not logged in, **When** they navigate to any page, **Then** they see a sidebar containing the application branding and a prominent login button/link.
2. **Given** a visitor is not logged in, **When** they navigate to any protected page (dashboard, tools, users, assignments, budget, reports, settings), **Then** the main content area shows a friendly message explaining authentication is required, while the sidebar remains visible with the login option.
3. **Given** a visitor is not logged in, **When** they navigate directly to `/login`, **Then** they see the existing login form without any redundant prompt.
4. **Given** a visitor clicks the login button in the sidebar, **When** they successfully authenticate, **Then** they are returned to the page they originally requested.
5. **Given** a visitor is not logged in, **When** they access the application root `/`, **Then** they see the sidebar with login option and a login prompt in the main content area.
6. **Given** a user logs in with the "viewer" role, **When** the sidebar renders, **Then** it shows only Dashboard, Assignments (filtered to their own), and Settings — no Tools, Users, Budget, or Reports entries.
7. **Given** a user logs in with the "admin" role, **When** the sidebar renders, **Then** it shows the full navigation: Dashboard, Tools, Users, Assignments, Budget, Reports, Settings.
8. **Given** a viewer-role user navigates directly to a restricted URL (e.g., `/users`, `/budget`), **When** the page loads, **Then** they see an "access restricted" message in the content area (sidebar still visible with their allowed items).
9. **Given** a viewer-role user navigates to the Dashboard, **When** the page loads, **Then** they see a personalized summary: their own assigned tools count, their total license cost, and their recent assignment activity — not the system-wide admin metrics.

---

### User Story 2 - Rename Department to Circle (Priority: P1)

All references to "Department" throughout the application are renamed to "Circle" to align with Holacracy organizational terminology. This includes labels, form fields, table headers, report groupings, data exports, and database storage.

**Why this priority**: Terminology consistency is fundamental to user trust and organizational alignment. Holacracy circles are a core concept, and incorrect terminology causes confusion across all features.

**Independent Test**: Can be tested by searching the entire UI for any occurrence of "Department" and verifying it now reads "Circle" in all contexts (forms, tables, reports, CSV import headers).

**Acceptance Scenarios**:

1. **Given** any page in the application, **When** a user views form labels, table headers, or report sections that previously said "Department", **Then** they see "Circle" instead.
2. **Given** a user creates or edits a user profile, **When** they fill in the organizational unit field, **Then** the field is labeled "Circle".
3. **Given** a user views the reports page, **When** they see the organizational breakdown table, **Then** the header reads "License distribution and cost by circle" and the grouping column is "Circle".
4. **Given** a user bulk-imports users via CSV, **When** they prepare the CSV file, **Then** the expected header column is "circle" (not "department").
5. **Given** existing data in the system with department values, **When** the rename is applied, **Then** all existing data is preserved — only the label/column name changes, not the stored values.

---

### User Story 3 - Editable Tool Tiers with Change History (Priority: P2)

Administrators can edit existing access tiers for a tool (name, description, monthly cost, active status). Every change to a tier is recorded in the change history, providing a full audit trail of pricing and configuration modifications over time.

**Why this priority**: Tier pricing changes directly affect budgets and cost reporting. Having editable tiers with an audit trail ensures pricing can evolve while maintaining accountability.

**Independent Test**: Can be tested by editing a tier's monthly cost, then viewing the tool's change history to verify the old and new values are recorded with the timestamp and user who made the change.

**Acceptance Scenarios**:

1. **Given** an administrator views a tool's detail page, **When** they click edit on an existing tier, **Then** they can modify the tier name, description, monthly cost, and active status.
2. **Given** an administrator changes a tier's monthly cost from $50 to $75, **When** the change is saved, **Then** a change history entry is created recording the field changed, old value ($50), new value ($75), the administrator who made the change, and the timestamp.
3. **Given** a tier has active license assignments, **When** an administrator edits the tier's cost, **Then** existing assignments retain their original `costAtAssignment` value — only new assignments use the updated cost.
4. **Given** an administrator deactivates a tier, **When** the tier has active assignments, **Then** the system warns the administrator and prevents deactivation until assignments are reassigned or revoked.

---

### User Story 4 - Editable License Assignments with Retrospective Dating (Priority: P2)

Administrators can edit existing license assignments and create assignments with a past effective date. This supports scenarios where tool access was granted informally and needs to be recorded after the fact, or where assignment details need correction.

**Why this priority**: Real-world tool provisioning often happens informally before formal tracking. Retrospective dating ensures accurate historical records and cost reporting.

**Independent Test**: Can be tested by creating a new assignment with a past date (e.g., two months ago) and verifying it appears correctly in historical reports and budget calculations for that period.

**Acceptance Scenarios**:

1. **Given** an administrator creates a new license assignment, **When** they fill out the assignment form, **Then** they can optionally select a past "effective from" date instead of defaulting to today.
2. **Given** an administrator sets an assignment's effective date to January 15, **When** the assignment is saved, **Then** the assignment's `assignedAt` reflects January 15 and cost calculations for January onward include this assignment.
3. **Given** an existing active assignment, **When** an administrator edits it, **Then** they can change the assigned tier (triggering a tier change with history) and update meta information fields.
4. **Given** an administrator edits an assignment's tier, **When** saved, **Then** the cost snapshot is updated to the new tier's current cost and a change history entry records the tier change.
5. **Given** a retrospective assignment date is in the past, **When** the effective date is before the tool or user was created in the system, **Then** the system rejects the date with a validation message.

---

### User Story 5 - Assignment Meta Information Fields (Priority: P2)

License assignments include additional metadata fields: a workspace identifier, a free-text comments/notes field for recording user interactions or events, and an API key field. These fields help administrators track the practical details of how a license is being used.

**Why this priority**: License management requires context beyond just "who has what tool." Workspace, API keys, and notes capture the operational reality of tool usage and are essential for troubleshooting and auditing.

**Independent Test**: Can be tested by creating an assignment with all meta fields populated, then verifying the data persists and displays correctly on the assignment detail view and in the assignments table.

**Acceptance Scenarios**:

1. **Given** an administrator creates or edits a license assignment, **When** they view the assignment form, **Then** they see fields for workspace, API key, and comments/notes.
2. **Given** an administrator fills in the workspace field with "team-alpha-prod", **When** the assignment is saved, **Then** the workspace value is stored and visible on the assignment record.
3. **Given** an administrator enters an API key, **When** the assignment is saved and later viewed, **Then** the API key is stored and displayed in a masked format (e.g., showing only the last 4 characters) with an option to reveal/copy the full value.
4. **Given** an administrator adds a comment "User requested upgrade on 2026-02-15 — approved by CTO", **When** the assignment is saved, **Then** the comment is stored with a timestamp and visible in the assignment's detail view.
5. **Given** an assignment has multiple comments over time, **When** an administrator views the assignment, **Then** comments are displayed in chronological order, each with its creation timestamp.
6. **Given** the assignments table/list view, **When** an administrator views the table, **Then** the workspace column is visible (API key and comments are accessible from the detail/edit view, not the table).

---

### User Story 6 - Budget Billed Costs Tracking (Priority: P3)

The budget system gains a new "billed costs" concept alongside the existing cost calculations (renamed from "actual costs" to "expected costs"). Expected costs are derived from active license assignments. Billed costs are manually entered amounts representing invoices or charges received from vendors, allowing multiple entries per budget period. This enables administrators to compare what they expected to pay versus what was actually billed.

**Why this priority**: Budget accuracy requires tracking both projected and actual invoiced amounts. The distinction between expected (calculated from assignments) and billed (from invoices) costs is essential for financial reconciliation but builds on existing budget infrastructure.

**Independent Test**: Can be tested by navigating to a budget period, adding two billed cost entries with different amounts and descriptions, then verifying the billed total, expected total, and variance are all displayed correctly.

**Acceptance Scenarios**:

1. **Given** an administrator views a budget period, **When** they see the cost summary, **Then** they see three figures: planned amount, expected costs (calculated from active assignments), and total billed costs (sum of manual entries).
2. **Given** an administrator views a budget period, **When** they click "Add billed cost", **Then** they can enter an amount, a required invoice date, a description (e.g., "OpenAI January invoice"), and an optional vendor reference.
3. **Given** a budget period has three billed cost entries ($500, $750, $200), **When** the administrator views the period summary, **Then** the total billed amount shows $1,450 and all three entries are listed individually.
4. **Given** the budget overview page, **When** the administrator views the period table, **Then** each period row shows planned, expected, and billed amounts with a variance column (billed minus expected).
5. **Given** the reports page shows "actual costs", **When** the terminology update is applied, **Then** the label reads "expected costs" (derived from assignments) and a separate "billed costs" column appears where applicable.
6. **Given** a billed cost entry exists, **When** an administrator edits or deletes it, **Then** the change is recorded in the audit history.

---

### Edge Cases

- What happens when a user attempts to set a retrospective assignment date far in the past (e.g., before the fiscal year)? The system allows it but shows a warning if the date is more than 12 months in the past.
- What happens when a tier is edited while assignments reference it? Existing assignment cost snapshots are not affected; only new assignments use the updated price.
- What happens when billed cost entries are added for an archived budget period? The system prevents modifications to archived budget periods.
- What happens if the API key field is left empty on an assignment? The API key is optional — it can be added later when available.
- What happens when bulk-importing users with the old "department" CSV header? The system accepts both "department" and "circle" as valid headers during a transition period, mapping both to the circle field.
- What happens when a comment is very long? Comments are limited to 2000 characters.
- What happens when a viewer-role user bookmarks or shares a URL to an admin-only page? They see their limited sidebar and an "access restricted" message in the content area — no data is exposed.

## Clarifications

### Session 2026-03-03

- Q: Which sidebar items should viewer (non-admin) users see? → A: Only Dashboard, Assignments (own assignments), and Settings.
- Q: Should each billed cost entry include an invoice date? → A: Yes, a required invoice date on each entry.
- Q: Should the viewer's Assignments page show only their own assignments, or all assignments in read-only mode? → A: Own assignments only.
- Q: Should the viewer's Dashboard show a personalized summary or the same system-wide view as admins? → A: Personalized — own assigned tools count, total license cost, and recent assignment activity.

## Requirements *(mandatory)*

### Functional Requirements

**Authentication & Access**

- **FR-001**: System MUST display the sidebar with application branding and a login option to unauthenticated visitors on all pages.
- **FR-002**: System MUST display a login prompt in the main content area on all protected routes when the user is not authenticated.
- **FR-003-A**: System MUST redirect authenticated users back to the originally requested page after successful login (return URL preservation).
- **FR-003-B**: System MUST show viewer-role users a limited sidebar containing only: Dashboard, Assignments (own assignments only), and Settings.
- **FR-003-C**: System MUST show admin-role users the full sidebar: Dashboard, Tools, Users, Assignments, Budget, Reports, Settings.
- **FR-003-D**: System MUST display an "access restricted" message when a viewer-role user navigates directly to a page outside their allowed sections (Tools, Users, Budget, Reports).
- **FR-003-E**: System MUST filter the Assignments page for viewer-role users to show only licenses assigned to them — no other users' assignments are visible.
- **FR-003-F**: System MUST display a personalized Dashboard for viewer-role users showing: their assigned tools count, their total license cost, and their recent assignment activity.

**Terminology Rename**

- **FR-004**: System MUST replace all UI occurrences of "Department" with "Circle" (labels, headers, form fields, tooltips, placeholder text).
- **FR-005**: System MUST rename the underlying data column from `department` to `circle` while preserving all existing data values.
- **FR-006**: System MUST accept both "department" and "circle" as valid CSV column headers during bulk user import for backward compatibility.

**Tool Tier Editing**

- **FR-007**: System MUST allow administrators to edit an existing tier's name, description, monthly cost, and active status.
- **FR-008**: System MUST record all tier edits in the change history with field name, old value, new value, user, and timestamp.
- **FR-009**: System MUST NOT retroactively change the cost snapshot on existing license assignments when a tier's cost is edited.
- **FR-010**: System MUST prevent deactivation of a tier that has active license assignments, displaying a warning message.

**License Assignment Editing**

- **FR-011**: System MUST allow administrators to edit existing license assignments (tier change, meta fields).
- **FR-012**: System MUST allow setting a past effective date ("assigned at") when creating or editing assignments.
- **FR-013**: System MUST validate that retrospective dates are not before the creation date of the assigned user or tool.
- **FR-014**: System MUST display a warning (non-blocking) when retrospective dates are more than 12 months in the past.
- **FR-015**: System MUST record all assignment edits in the change history.

**Assignment Meta Information**

- **FR-016**: System MUST provide a "workspace" text field (optional, max 200 characters) on the assignment form.
- **FR-017**: System MUST provide an "API key" text field (optional, max 500 characters) stored securely and displayed in masked format with a reveal/copy option.
- **FR-018**: System MUST provide a "comments" section where administrators can add timestamped notes (max 2000 characters each) to an assignment.
- **FR-019**: System MUST display comments in chronological order on the assignment detail view.
- **FR-020**: System MUST show the workspace column in the assignments list/table view.

**Budget Billed Costs**

- **FR-021**: System MUST rename all UI references of "actual costs" to "expected costs" (these are the costs calculated from active assignments).
- **FR-022**: System MUST provide a mechanism to add, edit, and delete billed cost entries for each budget period.
- **FR-023**: Each billed cost entry MUST include an amount (in cents), a required invoice date, a description, and an optional vendor reference.
- **FR-024**: System MUST allow multiple billed cost entries per budget period.
- **FR-025**: System MUST display the sum of billed costs alongside planned and expected costs for each budget period.
- **FR-026**: System MUST show a variance column (billed minus expected) on the budget overview.
- **FR-027**: System MUST prevent adding or modifying billed cost entries on archived budget periods.
- **FR-028**: System MUST record creation, editing, and deletion of billed cost entries in the change history.

### Key Entities

- **Circle** (renamed from Department): The organizational unit within the Holacracy structure. Stored as a text field on user profiles, used for grouping in reports.
- **Access Tier**: A pricing/feature level for a tool. Now fully editable with all changes tracked in history.
- **License Assignment**: Links a user to a tool at a specific tier. Enhanced with workspace, API key, and timestamped comments. Supports retrospective effective dates.
- **Assignment Comment**: A timestamped note attached to a license assignment, recording interactions, events, or administrative notes.
- **Billed Cost Entry**: A manual cost record attached to a budget period, representing an actual invoice or charge from a vendor. Includes a required invoice date, amount, description, and optional vendor reference. Multiple entries allowed per period.
- **Budget Period**: A time segment (month or quarter) within an annual budget. Now tracks three cost dimensions: planned (manually set target), expected (calculated from assignments), and billed (sum of manual entries).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Unauthenticated visitors can reach the login page from any protected route within one click, with 100% of protected routes showing the login prompt.
- **SC-002**: All user-facing text referencing "Department" is replaced with "Circle" with zero remaining occurrences of the old terminology.
- **SC-003**: Administrators can complete a tier edit (change cost and save) in under 30 seconds, with the change history entry appearing immediately.
- **SC-004**: Administrators can create a retrospective license assignment (past date + meta fields) in under 60 seconds.
- **SC-005**: Budget periods display planned, expected, and billed cost figures, with the variance calculation accurate to the cent.
- **SC-006**: All data modifications (tier edits, assignment edits, billed cost changes) produce corresponding change history entries with 100% coverage.
- **SC-007**: 90% of administrators can add a billed cost entry to a budget period on first attempt without documentation assistance.
