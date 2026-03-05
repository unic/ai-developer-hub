# Feature Specification: Optional Fields & Overview UX Improvements

**Feature Branch**: `006-optional-fields-ux`
**Created**: 2026-03-05
**Status**: Draft
**Input**: User description: "The workspace field on license assignments should not be mandatory. Also, the circle field on the users should also not be mandatory. All overview lists should have the option to show more entries per page. Also add quick action buttons in the overviews to make editing and viewing of details easier."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Optional Workspace on License Assignment (Priority: P1)

An administrator creates or edits a license assignment without specifying a workspace. The workspace field is no longer required to save the record — it can be left blank when the workspace is unknown, not applicable, or to be determined later.

**Why this priority**: This directly unblocks users who are blocked by a mandatory field that does not always have a meaningful value. Removing the constraint restores data-entry flexibility and reduces friction for a core workflow.

**Independent Test**: Can be fully tested by opening the license assignment form, leaving the workspace field empty, and saving — delivering the value of unrestricted license assignment creation.

**Acceptance Scenarios**:

1. **Given** a user is creating a new license assignment, **When** they leave the workspace field blank and submit the form, **Then** the assignment is saved successfully without a validation error.
2. **Given** a user is editing an existing license assignment that has a workspace set, **When** they clear the workspace field and save, **Then** the assignment is updated with no workspace value.
3. **Given** a user is creating a license assignment and leaves workspace blank, **When** the record is saved, **Then** the overview list displays the assignment with an empty or "—" placeholder for the workspace column.

---

### User Story 2 - Optional Circle on User (Priority: P2)

An administrator creates or edits a user profile without specifying a circle. The circle field is no longer required to save the record — it can be left blank when the circle is unknown, not yet assigned, or not applicable.

**Why this priority**: Same class of problem as the workspace field — a mandatory field without universal applicability blocks legitimate data entry. Fixing it ensures user management is not unnecessarily constrained.

**Independent Test**: Can be fully tested by opening the user form, leaving the circle field empty, and saving — delivering the value of unrestricted user creation.

**Acceptance Scenarios**:

1. **Given** a user is creating a new user profile, **When** they leave the circle field blank and submit the form, **Then** the user is saved successfully without a validation error.
2. **Given** a user is editing an existing user that has a circle set, **When** they clear the circle field and save, **Then** the user profile is updated with no circle value.
3. **Given** a user profile has no circle assigned, **Then** the overview list displays the user with an empty or "—" placeholder in the circle column.

---

### User Story 3 - Configurable Page Size in Overview Lists (Priority: P3)

An administrator viewing any overview list (e.g., users, license assignments, tools, budgets) can choose how many entries to display per page — with options beyond the current default — so they can scan more records at once without excessive pagination.

**Why this priority**: Improves navigation efficiency for power users and administrators who manage large datasets. Does not block any existing functionality.

**Independent Test**: Can be fully tested on any single overview list by selecting a larger page-size option and confirming the correct number of rows is displayed.

**Acceptance Scenarios**:

1. **Given** a user is viewing an overview list, **When** they select a larger page-size option (e.g., 25, 50, 100), **Then** the list reloads displaying up to that many entries per page.
2. **Given** a user selects a page-size option, **When** the total number of records is less than the selected page size, **Then** all available records are shown on a single page with no additional pagination controls.
3. **Given** a user navigates away from an overview and returns, **When** the page loads, **Then** a reasonable default page size is applied (the user's last selection may or may not persist — see Assumptions).
4. **Given** a user is on page 3 of a list and then changes the page size, **When** the new page size is applied, **Then** the list resets to page 1.

---

### User Story 4 - Quick Action Buttons in Overview Lists (Priority: P4)

An administrator viewing any overview list sees inline quick action buttons (Edit, View Details, and Delete) directly on each row, eliminating the need to navigate into a record just to perform common actions. Delete requires a confirmation step before the record is removed.

**Why this priority**: Reduces the number of clicks required for routine operations, improving overall workflow efficiency. Complements the other overview improvements in this feature.

**Independent Test**: Can be fully tested by verifying that each row in a single overview list displays Edit, View Details, and Delete buttons, and that clicking each performs the correct action or navigation.

**Acceptance Scenarios**:

1. **Given** a user is viewing an overview list, **When** the list renders, **Then** each row displays an "Edit" button, a "View Details" button, and a "Delete" button.
2. **Given** a user clicks the "Edit" quick action button on a row, **When** the action is triggered, **Then** the user is taken directly to the edit form for that record.
3. **Given** a user clicks the "View Details" quick action button on a row, **When** the action is triggered, **Then** the user is taken directly to the detail view for that record.
4. **Given** a user clicks the "Delete" quick action button on a row, **When** the action is triggered, **Then** a confirmation dialog appears before any deletion occurs.
5. **Given** a user confirms the delete confirmation dialog, **When** the confirmation is accepted, **Then** the record is deleted and removed from the list.
6. **Given** a user dismisses the delete confirmation dialog, **When** the confirmation is cancelled, **Then** the record is not deleted and the list remains unchanged.
7. **Given** a user views a list on a narrow screen, **When** the quick action buttons are rendered, **Then** the buttons remain accessible and do not break the row layout.

---

### Edge Cases

- What happens when a license assignment previously required workspace and now existing records have a blank workspace — the system must handle null/empty gracefully in display and filtering; these records must appear when the "None / Unassigned" workspace filter is applied.
- What happens when a user previously required circle and now existing user records have no circle — same as above; these records must appear when the "None / Unassigned" circle filter is applied.
- What happens when the selected page size exceeds the total number of records — all records should display on one page.
- What happens when there is only one record in the list — pagination controls and quick action buttons must still render correctly.
- What happens when an overview list has no records — empty state must be handled cleanly alongside the page-size selector.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The workspace field on license assignment creation and edit forms MUST be optional — users MUST be able to save a license assignment without providing a workspace value.
- **FR-002**: The circle field on user creation and edit forms MUST be optional — users MUST be able to save a user profile without providing a circle value.
- **FR-003**: The system MUST accept and persist a null or empty workspace value on license assignments without returning a validation error.
- **FR-004**: The system MUST accept and persist a null or empty circle value on user profiles without returning a validation error.
- **FR-005**: All overview list pages MUST provide a page-size selector allowing users to choose from at least the following options: 10 (default), 25, 50, 100.
- **FR-006**: When a user changes the page-size setting, the list MUST reset to the first page and display the correct number of entries.
- **FR-007**: All overview list pages MUST display an "Edit" quick action button on each row that navigates the user to the edit form for that record.
- **FR-008**: All overview list pages MUST display a "View Details" quick action button on each row that navigates the user to the detail view for that record.
- **FR-009**: All overview list pages MUST display a "Delete" quick action button on each row. Activating it MUST trigger a confirmation dialog before the record is deleted.
- **FR-010**: Quick action buttons MUST be visible and usable without requiring the user to open a dropdown or context menu (they are directly visible on the row).
- **FR-011**: If the user cancels the delete confirmation, the record MUST remain unchanged.
- **FR-012**: Overview lists displaying license assignments MUST render a blank workspace gracefully (e.g., show "—" or leave the cell empty) without errors.
- **FR-013**: Overview lists displaying users MUST render a blank circle gracefully without errors.
- **FR-014**: Where a workspace filter exists on the license assignments overview, it MUST include a "None / Unassigned" option that returns all assignments with no workspace value.
- **FR-015**: Where a circle filter exists on the users overview, it MUST include a "None / Unassigned" option that returns all users with no circle value.

### Key Entities

- **License Assignment**: Represents the allocation of an AI tool license to a user or team. Has an optional workspace attribute (free-text string) indicating which workspace context the license applies to.
- **User**: Represents a platform user. Has an optional circle attribute (free-text string) indicating which organizational circle or team the user belongs to.
- **Overview List**: A paginated tabular view of records (users, license assignments, tools, budgets, etc.) that supports filtering, sorting, configurable page size, and per-row quick actions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can create and save a license assignment without providing a workspace value in zero additional steps compared to providing one.
- **SC-002**: Users can create and save a user profile without providing a circle value in zero additional steps compared to providing one.
- **SC-003**: All overview list pages expose a page-size selector with at least 4 size options (10, 25, 50, 100).
- **SC-004**: Selecting a different page size takes effect immediately without a full page reload, and the correct number of records is displayed.
- **SC-005**: Each row in every overview list displays 3 quick action buttons (Edit, View Details, Delete) without any additional clicks or hover interactions required to reveal them.
- **SC-006**: Clicking a quick action button navigates to the correct destination in under 1 second.
- **SC-007**: No existing records with previously mandatory fields (workspace, circle) are broken or cause errors after these fields become optional.

## Clarifications

### Session 2026-03-05

- Q: Are workspace and circle free-text fields or references to predefined lists/entities? → A: Both are free-text fields (plain strings, no separate entity or foreign-key relationship).
- Q: Should quick action buttons also include a Delete action, or only Edit and View Details? → A: Include a Delete quick action button with a confirmation step on each row.
- Q: Should filtering/searching by workspace or circle include a "None/Unassigned" option now that these fields can be blank? → A: Yes — add a "None / Unassigned" filter option to workspace and circle filters so users can explicitly find records with no value assigned.

## Assumptions

- The current default page size across overview lists is 10 entries per page.
- Page-size preference does not need to persist across browser sessions — a sensible default (10) is applied on each page load.
- "All overview lists" refers to all paginated tabular views in the application (users, license assignments, AI tools, budgets, and any similar list screens).
- Quick action buttons are rendered as icon buttons or compact labeled buttons in a dedicated "Actions" column at the end of each row.
- Existing navigation or row-click behavior (if any) is preserved alongside the new quick action buttons — they are additive, not replacements.
- The underlying data schema supports nullable workspace and circle fields (or will be updated as part of this feature).
