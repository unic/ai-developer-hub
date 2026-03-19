# Feature Specification: Polish User & License UI

**Feature Branch**: `017-polish-user-ui`
**Created**: 2026-03-17
**Status**: Draft
**Input**: User description: "Polish various areas of the application — user overview, user detail, license assignments, license assignment details, and settings integrations."

## Clarifications

### Session 2026-03-17

- Q: What should happen to the existing `/users/new` page when introducing the add-user experience? → A: Keep and improve the existing `/users/new` page form to include all fields; do not convert to a dialog.
- Q: Should the per-user Claude sync button on user detail pages also move to settings? → A: No. Keep per-user sync on user detail; only move the bulk "Sync All" to settings.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Inline Edit User from Overview (Priority: P1)

An admin viewing the user overview list wants to quickly edit a user's details without navigating away from the list. Currently both the "View" and "Edit" buttons navigate to the same user detail page. The edit button should instead open a dialog with all editable fields (name, email, circle, role, profile, GitHub username), similar to how license assignment editing works in the assignments overview.

**Why this priority**: This is the most impactful UX improvement — it eliminates unnecessary page navigation for a frequent admin task and resolves a confusing duplicate-link issue.

**Independent Test**: Can be fully tested by clicking the edit button on any user row and verifying a dialog opens with pre-populated fields that can be saved without leaving the page.

**Acceptance Scenarios**:

1. **Given** an admin is on the users overview page, **When** they click the "Edit" button on a user row, **Then** a dialog opens with the user's current details pre-populated in editable fields (name, email, circle, role, profile, GitHub username).
2. **Given** the edit dialog is open, **When** the admin modifies fields and clicks "Save", **Then** the changes are persisted and the table row updates to reflect the new values.
3. **Given** the edit dialog is open, **When** the admin clicks "Cancel" or outside the dialog, **Then** no changes are saved and the dialog closes.
4. **Given** a non-admin (viewer) is on the users overview, **When** they view the action buttons, **Then** only the "View" button is available (no edit button).

---

### User Story 2 - Unified Filters on User Overview (Priority: P1)

An admin or viewer browsing the user list wants consistent, intuitive filtering. Currently the "No Circle" filter is a standalone toggle button visually separate from the faceted Role and Status filters. All filters — including Circle and a new Profile filter — should use the same faceted filter pattern for visual and behavioral consistency.

**Why this priority**: Filter inconsistency creates confusion and limits discoverability. Unifying filters improves the experience across the most-visited page.

**Independent Test**: Can be tested by verifying all four filters (Circle, Role, Status, Profile) appear as faceted filters with consistent styling and behavior.

**Acceptance Scenarios**:

1. **Given** a user is on the users overview page, **When** they look at the filter area, **Then** they see faceted filters for Circle, Role, Status, and Profile — all with the same visual style.
2. **Given** a user opens the Circle filter, **When** they select one or more circles, **Then** the table shows only users belonging to those circles.
3. **Given** a user opens the Profile filter, **When** they select "Boost", **Then** only users with the "Boost" profile are shown.
4. **Given** multiple filters are active, **When** the user clicks "Reset" or clears filters, **Then** all filters are cleared and the full list is shown.

---

### User Story 3 - Complete Add User Form (Priority: P1)

An admin adding a new user expects the creation form to include all the same fields available on the edit form. The existing `/users/new` page form currently lacks some fields present in the edit form. The add-user form should be enhanced to include all fields: name, email, password, circle, role, profile, and GitHub username — achieving full parity with the edit form (plus the password field which is create-only).

**Why this priority**: Parity between create and edit forms prevents confusion and ensures all user attributes can be set at creation time.

**Independent Test**: Can be tested by navigating to the add-user page and verifying all fields are present and the user is successfully created.

**Acceptance Scenarios**:

1. **Given** an admin clicks "Add User" on the users overview, **When** the `/users/new` page loads, **Then** it contains fields for name, email, password, circle, role, profile, and GitHub username.
2. **Given** the admin fills out all required fields and submits, **When** creation succeeds, **Then** the admin is redirected to the users overview and a success notification is shown.
3. **Given** the admin submits with invalid data, **When** validation fails, **Then** inline error messages appear on the relevant fields.

---

### User Story 4 - Assign License from User Detail (Priority: P2)

An admin viewing a specific user's detail page wants to directly assign a new license to that user without navigating to the assignments page. A button on the user detail page should open an assign-license dialog pre-filled with the current user.

**Why this priority**: Streamlines the most common workflow — viewing a user and then assigning them a tool license.

**Independent Test**: Can be tested by navigating to a user detail page, clicking "Assign License", selecting a tool and tier, and verifying the assignment appears in the user's assigned tools list.

**Acceptance Scenarios**:

1. **Given** an admin is on a user detail page for an active user, **When** they click "Assign License", **Then** a dialog opens with the user pre-selected and tool/tier dropdowns available.
2. **Given** the admin selects a tool and tier, **When** they confirm the assignment, **Then** the license appears in the user's assigned tools list with "Active" status.
3. **Given** the user already has an active assignment for the selected tool, **When** the admin assigns a new tier, **Then** the previous assignment is automatically deactivated and replaced.

---

### User Story 5 - Reactivate Revoked License from User Detail (Priority: P2)

An admin viewing a user's detail page sees revoked licenses and wants to reactivate one without going through the full assignment flow. A "Reactivate" action on revoked license rows should create a new active assignment for the same tool and tier.

**Why this priority**: Reduces friction for a common admin task — reinstating a user's access after a temporary revocation.

**Independent Test**: Can be tested by clicking "Reactivate" on a revoked license and verifying a new active assignment is created with the same tool and tier.

**Acceptance Scenarios**:

1. **Given** an admin views a user detail page with a revoked license, **When** they click "Reactivate" on that license row, **Then** a confirmation dialog appears showing the tool, tier, and cost.
2. **Given** the admin confirms reactivation, **When** the action completes, **Then** a new active assignment is created for the same tool and tier, and the list updates.
3. **Given** the tool's license capacity is full, **When** the admin attempts to reactivate, **Then** an error message indicates no capacity is available.

---

### User Story 6 - Unified Filters on License Assignments Overview (Priority: P2)

An admin browsing the license assignments overview wants additional faceted filters for Tool, Tier, and Workspace alongside the existing Status and Source filters. All filters should use the same faceted filter pattern.

**Why this priority**: As the number of assignments grows, filtering by tool, tier, and workspace becomes essential for efficient management.

**Independent Test**: Can be tested by verifying all five filters (Status, Source, Tool, Tier, Workspace) appear as faceted filters and correctly narrow the results.

**Acceptance Scenarios**:

1. **Given** a user is on the assignments overview, **When** they look at the filter area, **Then** they see faceted filters for Status, Source, Tool, Tier, and Workspace.
2. **Given** a user selects a specific tool from the Tool filter, **When** the filter is applied, **Then** only assignments for that tool are shown.
3. **Given** a user selects a Workspace filter value, **When** applied, **Then** only assignments with that workspace are shown. Assignments with no workspace are filterable via a "No Workspace" option.

---

### User Story 7 - Searchable User Selection in Assign License Dialog (Priority: P2)

An admin assigning a license needs to find a specific user from a potentially large list. The current plain dropdown is impractical at scale. The user selection should support type-ahead search by name or email.

**Why this priority**: Critical for organizations with many users — a plain dropdown becomes unusable beyond a few dozen entries.

**Independent Test**: Can be tested by opening the assign-license dialog, typing a partial name or email, and verifying the list filters to matching users.

**Acceptance Scenarios**:

1. **Given** an admin opens the assign-license dialog, **When** they see the user selection field, **Then** it is a searchable input (combobox) rather than a plain dropdown.
2. **Given** the admin types a partial name, **When** matching users exist, **Then** a filtered list of matching users is shown (by name and email).
3. **Given** the admin types a query with no matches, **When** no users match, **Then** a "No users found" message is displayed.

---

### User Story 8 - Editable License Assignment Detail Fields (Priority: P3)

An admin viewing a license assignment detail page wants to edit fields inline (tier, workspace, assigned date, API key) with save functionality that matches the inline-edit pattern used on the user detail page.

**Why this priority**: Consistency with the user detail page editing pattern improves learnability and reduces cognitive load.

**Independent Test**: Can be tested by navigating to an assignment detail page, editing a field, saving, and verifying the change persists.

**Acceptance Scenarios**:

1. **Given** an admin views an active assignment detail page, **When** they see editable fields, **Then** the fields use the same inline-edit pattern as the user detail page (click to edit, save/cancel actions).
2. **Given** an admin edits the workspace field and clicks save, **When** the save completes, **Then** the new value is persisted and the change appears in the history.
3. **Given** a viewer views an assignment detail page, **When** they see the fields, **Then** they are read-only with no edit affordance.

---

### User Story 9 - Navigate to User from Assignment Detail (Priority: P3)

A user viewing a license assignment detail page wants to quickly navigate to the assigned user's detail page. The user name should be a clickable link.

**Why this priority**: Simple navigation improvement that connects related views and reduces clicks.

**Independent Test**: Can be tested by clicking the user name link on an assignment detail page and verifying navigation to the correct user detail page.

**Acceptance Scenarios**:

1. **Given** a user is viewing an assignment detail page, **When** they see the assigned user's name, **Then** it is a clickable link.
2. **Given** the user clicks the user name link, **When** the navigation completes, **Then** they are on the correct user's detail page.

---

### User Story 10 - Claude Console Integration Section in Settings (Priority: P3)

An admin managing integrations wants the Claude Console (Anthropic API) integration to have its own dedicated section in the settings/integrations page, separate from the GitHub integration. The "Sync Claude Costs" button (currently on the users overview page) should be moved into this new section, alongside sync status information.

**Why this priority**: Organizational improvement that groups related functionality logically and makes the integrations page a single place for all external service management.

**Independent Test**: Can be tested by navigating to settings/integrations and verifying the Claude Console section appears with sync functionality.

**Acceptance Scenarios**:

1. **Given** an admin navigates to Settings > Integrations, **When** the page loads, **Then** they see separate sections for GitHub Integration, Copilot Sync, and Claude Console Integration.
2. **Given** the Claude Console section is visible, **When** the admin looks at its contents, **Then** they see the "Sync Claude Costs" button, last sync status, and sync result information.
3. **Given** the admin clicks "Sync Claude Costs" in the settings page, **When** the sync completes, **Then** a success notification is shown with updated status.
4. **Given** the admin navigates to the users overview page, **When** they look at the action buttons, **Then** the "Sync Claude Costs" button is no longer present there (moved to settings).

---

### Edge Cases

- What happens when an admin tries to edit a deactivated user from the overview? The edit button should not appear for inactive users.
- What happens when the Circle or Profile filter has no matching users? The table should show an empty state message.
- What happens when a user is assigned in the dialog but the tool has reached maximum license capacity? An appropriate error message should be displayed.
- What happens when the Claude costs sync fails from the new settings location? An error notification should be shown with retry option.
- What happens when the searchable user combobox is used with hundreds of users? Results should be debounced and limited to a reasonable page size.
- What happens when an admin reactivates a license for a tool that has been deactivated since the original assignment? The reactivation should be blocked with an explanatory message.

## Requirements *(mandatory)*

### Functional Requirements

**User Overview**
- **FR-001**: The edit action on a user row MUST open a dialog instead of navigating to a new page.
- **FR-002**: The edit dialog MUST contain all editable user fields: name, email, circle, role, profile, and GitHub username.
- **FR-003**: The edit dialog MUST NOT be available for inactive users or non-admin users.
- **FR-004**: All user overview filters (Circle, Role, Status, Profile) MUST use the same faceted filter component and visual pattern.
- **FR-005**: The Circle filter MUST show all distinct circle values from existing users plus a "No Circle" option for users without a circle.
- **FR-006**: The Profile filter MUST show options: Boost, Maxed, Indie, and a "No Profile" option.
- **FR-007**: The existing `/users/new` page form MUST be enhanced to include all fields: name, email, password, circle, role, profile, and GitHub username — matching edit form field parity.

**User Detail**
- **FR-008**: The user detail page MUST include an "Assign License" action for active users (admin only).
- **FR-009**: The assign-license dialog on the user detail page MUST pre-select the current user and offer tool and tier selection.
- **FR-010**: Revoked license rows on the user detail page MUST show a "Reactivate" action (admin only).
- **FR-011**: Reactivation MUST create a new active assignment for the same tool and tier, respecting license capacity limits.

**License Assignments Overview**
- **FR-012**: The assignments overview MUST include faceted filters for Tool, Tier, and Workspace in addition to existing Status and Source filters.
- **FR-013**: The Workspace filter MUST include a "No Workspace" option for assignments without a workspace value.
- **FR-014**: The user selection in the assign-license dialog MUST be a searchable combobox supporting search by name and email.
- **FR-015**: The searchable combobox MUST handle large user lists efficiently with debounced filtering.

**License Assignment Detail**
- **FR-016**: Editable fields on the assignment detail page MUST follow the same inline-edit pattern used on the user detail page.
- **FR-017**: The assignment detail page MUST include a navigable link to the assigned user's detail page.

**Settings**
- **FR-018**: The integrations page MUST have a dedicated Claude Console Integration section.
- **FR-019**: The bulk "Sync All Claude Costs" button MUST be moved from the users overview page to the Claude Console Integration section in settings. The per-user sync button on individual user detail pages MUST remain in place.
- **FR-020**: The Claude Console section MUST display sync status information (last sync time, result).

### Key Entities

- **User**: Central entity with name, email, circle, role, profile, GitHub username, status. Participates in license assignments.
- **License Assignment**: Links a user to a tool tier. Has status (active/inactive), source, workspace, assigned date, optional API key.
- **AI Tool & Tier**: Tools with associated pricing tiers. Tiers define monthly cost and license capacity.
- **Integration Configuration**: Settings for external service connections (GitHub, Copilot, Claude Console) including sync status and history.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Admins can edit a user's details from the overview page in under 10 seconds without navigating away from the list.
- **SC-002**: All filter controls across user and assignment overview pages use the same visual pattern with no inconsistencies.
- **SC-003**: Admins can assign a license to a user directly from the user detail page in under 15 seconds.
- **SC-004**: Admins can reactivate a revoked license from the user detail page in under 5 seconds.
- **SC-005**: The searchable user selection allows finding a specific user among 500+ users in under 3 seconds of typing.
- **SC-006**: All integration management (GitHub, Copilot, Claude Console) is accessible from a single settings page.
- **SC-007**: Navigation between related views (assignment detail to user detail) requires at most one click.
- **SC-008**: The add-user form and edit-user dialog offer field parity (excluding password which is create-only).

## Assumptions

- The existing `updateUser` server action supports all the fields needed for the inline edit dialog — no new server actions are required for user editing.
- The `assignLicense` server action can be reused for both the user detail page assignment and the reactivation flow.
- Circle and Profile values can be dynamically extracted from existing user data for filter options (no static configuration needed).
- Tool and Tier filter options for the assignments overview can be derived from existing data in the tools and tiers tables.
- The Claude Console integration section in settings is informational and functional (sync trigger + status) — no new configuration fields (like API keys) are needed beyond what already exists.
- The "Sync Claude Costs" button removal from the users page is a full migration — the button will only exist in settings after this change.
