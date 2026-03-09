# Feature Specification: Better Tables

**Feature Branch**: `012-better-tables`
**Created**: 2026-03-06
**Status**: Draft
**Input**: User description: "Tables across the application should have sorting and potentially filtering available on most columns. Quick actions in table rows should be unified across the application, both in selection of icons and or tooltips or labels. Destructive actions for quick actions can be hidden behind a dot dot dot menu."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Column Sorting Across All Tables (Priority: P1)

As a user viewing any data table in the application, I want to click on column headers to sort data ascending or descending, so I can quickly find the information I need without scrolling through unsorted rows.

Currently, only a few columns on a few tables support sorting (e.g., Name and Vendor on the Tools table, Name and Circle on the Users table). Most columns across all tables lack sorting, making it difficult to organize data by cost, date, status, or other relevant fields.

**Why this priority**: Sorting is the most fundamental table interaction. Without it, users cannot efficiently locate data in growing lists. This delivers immediate value across every table in the application.

**Independent Test**: Can be fully tested by clicking any column header on any table and verifying the data reorders correctly. Delivers the value of instant data organization.

**Acceptance Scenarios**:

1. **Given** a user is viewing the Tools table, **When** they click the "Active Licenses" column header, **Then** the table sorts by that column in ascending order, and clicking again reverses to descending order
2. **Given** a user is viewing the Users table, **When** they click the "Email" column header, **Then** the table sorts alphabetically by email
3. **Given** a user is viewing the Assignments table, **When** they click the "Monthly Cost" column header, **Then** the table sorts numerically by cost amount
4. **Given** a user is viewing any table with a "Status" column, **When** they click the Status header, **Then** the table sorts by status values in a logical order
5. **Given** a user has sorted a column, **When** they click the same column header a third time, **Then** the sort is cleared and the table returns to its default order

---

### User Story 2 - Unified Quick Actions with Consistent Icons, Tooltips, and Labels (Priority: P1)

As a user performing row-level actions across different tables, I want the same type of action to always use the same icon, tooltip, and label, so the interface feels predictable and I don't have to re-learn interaction patterns on each page.

Currently, quick actions vary in presentation: some use icon-only buttons, some use text buttons (e.g., "View" text on Assignments vs. Eye icon on Tools), and tooltips or accessible labels are inconsistently applied. This creates confusion and reduces usability.

**Why this priority**: Consistency is essential for usability and accessibility. Users should not need to guess what an icon does or notice that the same action looks different on different pages. This is equal priority with sorting because it directly improves every table interaction.

**Independent Test**: Can be tested by navigating to each table page and verifying that the same action type (view, edit) uses the same icon, tooltip text, and accessible label everywhere.

**Acceptance Scenarios**:

1. **Given** a user hovers over a "View" action button on any table row, **When** the tooltip appears, **Then** it displays "View" consistently across all tables
2. **Given** a user hovers over an "Edit" action button on any table row, **When** the tooltip appears, **Then** it displays "Edit" consistently across all tables
3. **Given** a user uses a screen reader on any table, **When** the screen reader encounters an action button, **Then** it announces a clear, consistent accessible label (e.g., "View [item name]", "Edit [item name]")
4. **Given** a user views the Assignments table, **When** they look at the View action, **Then** it uses the Eye icon (not a text-only button) matching all other tables

---

### User Story 3 - Destructive Actions Hidden Behind Overflow Menu (Priority: P2)

As an administrator performing destructive actions (archive, deactivate, revoke, delete), I want these actions tucked behind a "more options" menu (three-dot / ellipsis menu) rather than displayed as direct icon buttons, so I am less likely to accidentally trigger a destructive action and the row actions area stays clean.

Currently, destructive actions like Archive, Deactivate, and Revoke are displayed as direct icon buttons alongside non-destructive actions like View and Edit. This increases the risk of accidental clicks and clutters the actions column.

**Why this priority**: Hiding destructive actions behind a menu reduces accidental destructive operations and simplifies the visible row actions. This is a meaningful UX improvement but slightly less critical than sorting and consistency since confirmation dialogs already protect against accidental execution.

**Independent Test**: Can be tested by verifying that destructive actions on every table are only accessible via the three-dot menu, not as direct icon buttons, and that they still trigger confirmation dialogs.

**Acceptance Scenarios**:

1. **Given** an admin views the Tools table, **When** they look at the row actions, **Then** they see View and Edit as direct icon buttons, and a three-dot menu containing "Archive"
2. **Given** an admin clicks the three-dot menu on a user row, **When** the menu opens, **Then** "Deactivate" appears as a menu item styled with a destructive/warning appearance
3. **Given** an admin selects "Revoke" from the three-dot menu on an assignment row, **When** they click it, **Then** the existing confirmation dialog still appears before the action executes
4. **Given** a non-admin user views any table, **When** they look at the row actions, **Then** they see only the View action as a direct button and no three-dot menu (since Edit and destructive actions are admin-only)

---

### User Story 4 - Column Filtering on Key Columns (Priority: P3)

As a user managing a large number of records, I want to filter table data by specific column values (e.g., status, role, vendor), so I can narrow down the displayed rows to only those relevant to my current task without relying solely on the global search.

Currently, tables have a global search input and a couple of custom toggle filters (e.g., "No Circle" on Users, "No Workspace" on Assignments). There is no standardized column-level filtering for categorical data like status, role, or vendor.

**Why this priority**: Column filtering enhances data exploration for power users but is additive — global search already provides basic filtering capability. This is a quality-of-life improvement that builds on the sorting foundation.

**Independent Test**: Can be tested by selecting a filter value on a categorical column and verifying only matching rows are displayed.

**Acceptance Scenarios**:

1. **Given** a user views the Users table, **When** they open a filter on the "Role" column and select "Admin", **Then** only users with the Admin role are displayed
2. **Given** a user views the Tools table, **When** they open a filter on the "Status" column and select "Active", **Then** only active tools are shown
3. **Given** a user views the Assignments table, **When** they filter by "Status" and select "Active", **Then** only active assignments are displayed
4. **Given** a user has applied a column filter, **When** they clear the filter, **Then** all rows are displayed again
5. **Given** a user has applied a column filter, **When** they also use the global search, **Then** both filters are applied together (intersection)

---

### Edge Cases

- What happens when a table has zero rows after filtering? The existing "No results" message should display.
- What happens when sorting a column that contains null or empty values? Null/empty values should sort to the end regardless of sort direction.
- What happens when the three-dot menu has only one destructive action? The menu should still render with that single item for consistency.
- What happens on a table with only one row? Sorting controls should still be visible and functional, even if sorting has no visible effect.
- What happens when a non-admin user views the actions column? They should see only the View button with no three-dot menu, and the actions column should not show empty space or orphaned menus where admin-only actions would be.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST enable sorting on all data columns across the Tools, Users, Assignments, Invoices, and Budget tables (excluding the actions column)
- **FR-002**: Column sorting MUST cycle through three states: ascending, descending, and unsorted (default)
- **FR-003**: Each sortable column header MUST display a visual indicator showing the current sort direction
- **FR-004**: System MUST display a tooltip on every quick-action button that describes the action (e.g., "View", "Edit")
- **FR-005**: Every quick-action button MUST have an accessible label that includes the action type and the item identifier (e.g., "View Cursor Pro", "Edit Alice Smith")
- **FR-006**: The "View" action MUST use the Eye icon consistently across all tables
- **FR-007**: The "Edit" action MUST use the Pencil icon consistently across all tables
- **FR-008**: All destructive actions (Archive, Deactivate, Revoke, Delete) MUST be placed inside a three-dot overflow menu, not as direct action buttons
- **FR-009**: Destructive menu items MUST be visually distinguished from non-destructive items (e.g., using a warning/destructive color)
- **FR-010**: Selecting a destructive action from the overflow menu MUST still trigger the existing confirmation dialog before executing
- **FR-011**: The three-dot overflow menu MUST only appear for users with permission to perform at least one destructive action on that row
- **FR-012**: System MUST provide column-level filters on categorical columns: Status columns on all tables, Role on Users, and Vendor on Tools
- **FR-013**: Column filters and global search MUST work together, with results showing the intersection of all active filters
- **FR-014**: Each active column filter MUST have a visible indicator and a way to clear it
- **FR-015**: The Download action on the Invoices table MUST remain a direct action button (not moved to overflow menu) since it is non-destructive

### Key Entities

- **Table Column Configuration**: Defines per-column settings including whether sorting is enabled, whether a filter is available, and the filter type (text search, categorical dropdown)
- **Quick Action**: A row-level action with a standardized icon, tooltip, accessible label, and visibility rules based on user role and item state
- **Overflow Menu**: A three-dot menu component that groups destructive actions for a table row, appearing only when the user has permissions for at least one contained action

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every data column across all five tables supports ascending/descending sorting with a single click
- **SC-002**: 100% of quick-action buttons display a tooltip on hover and have screen-reader-accessible labels
- **SC-003**: The same action type uses the same icon and tooltip text across all tables with zero variations
- **SC-004**: All destructive actions are accessible only through the overflow menu, reducing accidental destructive action attempts
- **SC-005**: Users can filter categorical columns and see results narrow to matching rows within 1 second
- **SC-006**: Applying column filters in combination with global search returns the correct intersection of results
- **SC-007**: Non-admin users see a clean actions column with no empty space or orphaned menus where admin-only actions would appear

## Assumptions

- The existing shared `DataTable` component already supports sorting and filtering capabilities — this feature enables and standardizes them rather than building from scratch.
- The Invoices list table and Budget list table, which currently use basic table components rather than the shared DataTable, will be migrated to use the shared component to gain sorting/filtering capabilities.
- Existing confirmation dialogs for destructive actions are adequate and do not need redesign — only the trigger mechanism changes (from direct button to menu item).
- The "Download" action on invoices is non-destructive and remains a direct button, not placed in the overflow menu.
- Tooltip and accessible label patterns follow the format: "[Action]" for tooltip, "[Action] [item name]" for aria-label (e.g., tooltip: "View", aria-label: "View Cursor Pro").
