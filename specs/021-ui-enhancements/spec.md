# Feature Specification: UI Enhancements — Assignment & User Detail Polish

**Feature Branch**: `021-ui-enhancements`
**Created**: 2026-03-24
**Status**: Draft
**Input**: User description: "Improve UX: clickable assigned tools in user detail, combine assignment detail/edit, allow pre-creation assignment dates, add workspace and API key to license assignment"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Clickable Assigned Tools in User Detail (Priority: P1)

When viewing a user's detail page, administrators see a list of assigned tools. Currently these tool names are plain text. Administrators need to quickly navigate to the assignment detail for any listed tool to review or edit assignment specifics (tier, workspace, API key, dates).

Each assigned tool entry in the user detail page should be a clickable link that navigates directly to the corresponding assignment detail page.

**Why this priority**: This is the simplest change with the highest daily impact — administrators frequently need to drill into assignment details from the user view, and having to navigate manually through the assignments list is a common friction point.

**Independent Test**: Can be fully tested by viewing any user with at least one assigned tool and clicking on the tool entry to confirm navigation to the correct assignment detail page.

**Acceptance Scenarios**:

1. **Given** a user detail page showing assigned tools, **When** an administrator clicks on an assigned tool entry, **Then** they are navigated to the assignment detail page for that specific assignment.
2. **Given** a user detail page showing multiple assigned tools (active and revoked), **When** an administrator clicks on any tool entry regardless of status, **Then** the correct assignment detail page opens.
3. **Given** a user detail page with assigned tools, **When** the tools list is displayed, **Then** each tool entry visually indicates it is clickable (e.g., cursor change, underline, or link styling).

---

### User Story 2 - Unified Assignment Detail View (Priority: P1)

The assignment detail page currently shows two separate sections: a read-only detail card and an edit form below it. This creates duplication — the same fields (tier, workspace, API key, assigned date) appear twice in different formats. The user detail page already uses a pattern where details are shown inline with edit capability. The assignment detail page should follow the same pattern, combining the detail display and edit controls into a single cohesive view.

**Why this priority**: This directly addresses user confusion and visual clutter. The current duplication is disorienting and makes the page unnecessarily long. Aligning with the existing user detail pattern creates UI consistency.

**Independent Test**: Can be fully tested by navigating to any active assignment detail page and verifying that fields are displayed once with inline edit capability, matching the user detail page pattern.

**Acceptance Scenarios**:

1. **Given** an active assignment detail page, **When** an administrator views the page, **Then** each editable field (tier, assigned date, workspace, API key) is displayed once with the ability to edit inline.
2. **Given** an active assignment detail page, **When** an administrator edits a field and saves, **Then** the field updates in place without page reload and shows the new value.
3. **Given** an inactive (revoked) assignment detail page, **When** an administrator views the page, **Then** fields are displayed in read-only mode without edit controls.
4. **Given** the unified assignment detail view, **When** comparing it to the user detail page, **Then** the interaction patterns (inline editing, save behavior, field layout) are visually consistent.

---

### User Story 3 - Allow Assignment Dates Before User Creation (Priority: P2)

Currently, the system prevents setting an assignment date earlier than the user's creation date. This restriction causes problems when backdating assignments for users who had tool access before they were registered in the system (e.g., migrating from another tracking system, or when the user account was created after the tool was already provisioned).

The system should allow assignment dates before the user creation date while still preventing dates in the future.

**Why this priority**: This is a targeted validation rule change that unblocks a real workflow need — backdating assignments during data migration or corrections — without affecting normal day-to-day assignment flows.

**Independent Test**: Can be tested by editing an existing assignment's date to a date before the user's creation date and confirming the system accepts it without error.

**Acceptance Scenarios**:

1. **Given** an assignment for a user created on 2025-06-01, **When** an administrator sets the assignment date to 2025-01-15, **Then** the system accepts the date without error.
2. **Given** an assignment for a user, **When** an administrator sets the assignment date to a future date, **Then** the system still rejects the date with an appropriate error message.
3. **Given** an assignment for a tool created on 2025-03-01, **When** an administrator sets the assignment date to 2025-02-01, **Then** the system still rejects the date (tool creation date validation remains).
4. **Given** an assignment date set more than 12 months in the past, **When** the date is saved, **Then** a warning is displayed but the date is still accepted.

---

### User Story 4 - Workspace and API Key Fields on New Assignment (Priority: P2)

When assigning a new license to a user from the user detail page, the current form only offers tool and tier selection. Workspace and API key must be set afterward by navigating to the assignment detail and editing it there. This is an extra step that slows down the workflow.

The new assignment form should include optional fields for workspace and API key, so administrators can provide all assignment details in a single step.

**Why this priority**: This completes the assignment creation workflow and reduces the number of steps for a common admin task. The fields already exist in the database schema and in the bulk import flow, so this aligns the manual creation experience with existing capabilities.

**Independent Test**: Can be tested by creating a new assignment from the user detail page with workspace and API key filled in, then verifying the values appear on the resulting assignment detail page.

**Acceptance Scenarios**:

1. **Given** the new assignment dialog on the user detail page, **When** an administrator opens it, **Then** optional fields for workspace and API key are available alongside tool and tier selection.
2. **Given** the new assignment form with workspace and API key filled in, **When** the administrator submits the form, **Then** the assignment is created with all provided values stored correctly.
3. **Given** the new assignment form, **When** the administrator leaves workspace and API key empty, **Then** the assignment is created successfully with those fields as empty (they remain optional).
4. **Given** the new assignment form, **When** an API key is provided, **Then** the key is stored encrypted, consistent with existing API key handling throughout the system.
5. **Given** the new assignment form, **When** a workspace value exceeding 200 characters is entered, **Then** the form displays a validation error.

---

### Edge Cases

- What happens when a user has no assigned tools? The user detail page should display a clear empty state with no broken clickable elements.
- What happens when navigating to an assignment that was deleted between page load and click? The assignment detail page should show an appropriate "not found" message.
- What happens when two administrators edit the same assignment field simultaneously? The last save wins; the system should not corrupt data.
- What happens when an API key contains special characters? The system should accept and correctly encrypt/decrypt any valid string up to 500 characters.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each assigned tool entry on the user detail page MUST be a navigable link to the corresponding assignment detail page.
- **FR-002**: The assignment detail page MUST display each field (status, tier, cost, assigned date, revoked date, workspace, API key) exactly once, with inline edit capability for administrators on active assignments.
- **FR-003**: The assignment detail page MUST remove the separate "Edit Assignment" form section that duplicates the detail display.
- **FR-004**: The system MUST allow assignment dates that are before the user's account creation date.
- **FR-005**: The system MUST continue to reject assignment dates that are in the future.
- **FR-006**: The system MUST continue to reject assignment dates that are before the tool's creation date.
- **FR-007**: The system MUST continue to display a warning for assignment dates more than 12 months in the past.
- **FR-008**: The new license assignment form MUST include an optional workspace text field (maximum 200 characters).
- **FR-009**: The new license assignment form MUST include an optional API key field (maximum 500 characters).
- **FR-010**: API keys provided during new assignment creation MUST be encrypted before storage, using the same encryption mechanism as existing API key handling.
- **FR-011**: The unified assignment detail view MUST show fields as read-only for revoked (inactive) assignments.
- **FR-012**: The unified assignment detail view MUST follow the same inline-editing pattern used on the user detail page for visual and behavioral consistency.

### Key Entities

- **License Assignment**: Represents a user's access to a specific tool tier. Key attributes: assigned date, status (active/inactive), workspace, encrypted API key, cost snapshot, source.
- **User**: The person to whom tools are assigned. Linked to assignments; detail page serves as the entry point for assignment navigation.
- **AI Tool / Tier**: The tool and pricing tier being assigned. Each tool has multiple tiers with associated costs.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Administrators can navigate from user detail to any assignment detail in a single click, reducing the number of steps from 3+ to 1.
- **SC-002**: The assignment detail page displays each field exactly once — no duplicate information visible on the page.
- **SC-003**: Assignment date changes to dates before user creation are accepted by the system without error, while future dates continue to be rejected.
- **SC-004**: New assignments can be created with workspace and API key in a single form submission, reducing the required steps from 2 operations (create + edit) to 1.
- **SC-005**: All four improvements maintain visual consistency with the existing user detail page patterns and design language.

## Assumptions

- The existing inline-editing pattern on the user detail page is the target UX pattern for the unified assignment detail view. No new interaction paradigms need to be designed.
- The existing API key encryption mechanism is reusable for new assignment creation without modification.
- The workspace and API key fields remain optional for all assignment creation flows (manual and bulk import).
- Removing the user-creation-date validation on assignment dates does not affect any downstream reporting or billing calculations.
- The "not found" behavior for deleted assignments already exists and does not need to be built as part of this feature.
