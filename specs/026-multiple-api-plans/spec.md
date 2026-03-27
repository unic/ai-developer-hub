# Feature Specification: Multiple Claude API Plan Connections

**Feature Branch**: `026-multiple-api-plans`
**Created**: 2026-03-27
**Status**: Draft
**Input**: User description: "The app supports one Claude API plan connection to pull the API usage for users. It should be extended to support multiple connected API plans. The goal is to show API usage on the profile and user page, without affecting the budget views."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Admin Connects Additional API Plans (Priority: P1)

An admin needs to connect the organization to multiple Claude API plans (e.g., separate plans for different departments, projects, or billing accounts). Currently, the system supports only one plan connection. The admin navigates to the Claude API settings area and adds a second (or third, etc.) API plan by providing the admin API key and a human-readable label for each plan. Each connected plan is listed with its label, connection status, and last sync time.

**Why this priority**: Without the ability to connect multiple plans, no other feature in this spec can function. This is the foundational capability.

**Independent Test**: Can be fully tested by an admin adding two or more API plan connections and verifying each appears in the settings list with correct status indicators.

**Acceptance Scenarios**:

1. **Given** an admin with one existing connected API plan, **When** the admin adds a second plan with a valid admin API key and label, **Then** both plans appear in the connected plans list with their respective labels and "Connected" status.
2. **Given** an admin viewing the connected plans list, **When** the admin removes a plan connection, **Then** the plan is disconnected, its historical usage data is retained, and it no longer appears as active.
3. **Given** an admin adding a new plan, **When** the provided API key is invalid or duplicates an existing connection, **Then** the system displays a clear error message and does not create the connection.

---

### User Story 2 - User API Keys Resolve Across Multiple Plans (Priority: P1)

When a user has a personal API key assigned (via license assignment), the system must resolve that key against all connected plans during sync. A user's API key may belong to any one of the connected plans. The sync process checks each plan to find the matching key and pulls usage data accordingly. Usage data on the profile page and user detail page reflects the correct plan source.

**Why this priority**: This is equally critical to Story 1 — users must see their usage data regardless of which plan their key belongs to. Without this, multi-plan support has no user-facing value.

**Independent Test**: Can be tested by assigning API keys from two different plans to two different users, running a sync, and verifying each user sees their correct usage data on their profile page.

**Acceptance Scenarios**:

1. **Given** two connected plans and a user whose API key belongs to Plan B, **When** the usage sync runs, **Then** the user's usage metrics are correctly fetched from Plan B and displayed on their profile.
2. **Given** a user whose API key does not match any connected plan, **When** the sync runs, **Then** the system logs a warning and the user's profile shows no usage data (with an appropriate message).
3. **Given** a completed sync across multiple plans, **When** a user views their profile page, **Then** usage data is displayed identically to the current single-plan experience — the plan source is transparent to the end user.

---

### User Story 3 - Aggregated Usage Across Plans on Admin User Page (Priority: P2)

An admin viewing a specific user's detail page sees the user's Claude API usage. If the organization has multiple plans and a user's key resolves to one specific plan, the admin can see which plan the usage comes from. The admin user page shows a plan label alongside usage data for clarity.

**Why this priority**: Provides admin visibility into which plan is driving costs for each user, enabling better cost allocation decisions.

**Independent Test**: Can be tested by viewing a user's detail page after syncing multiple plans and verifying the plan label appears next to the usage breakdown.

**Acceptance Scenarios**:

1. **Given** a user with usage data from Plan A, **When** an admin views that user's detail page, **Then** the usage breakdown includes the plan label (e.g., "Engineering Plan") alongside the cost and token data.
2. **Given** a user with no Claude API assignment, **When** an admin views that user's detail page, **Then** the Claude usage section shows an appropriate empty state.

---

### User Story 4 - Multi-Plan Workspace Cost Aggregation (Priority: P2)

The existing Claude global metrics dashboard (admin view) aggregates workspace costs across all connected plans. Each plan's workspaces are synced independently, and the dashboard shows combined or per-plan views of workspace-level costs.

**Why this priority**: Admins need a holistic view of Claude API spend across all plans for budgeting and governance purposes.

**Independent Test**: Can be tested by connecting two plans, syncing workspace data, and verifying the global Claude dashboard shows costs from both plans.

**Acceptance Scenarios**:

1. **Given** two connected plans each with workspace cost data, **When** an admin views the Claude global metrics dashboard, **Then** the total cost reflects the sum across both plans.
2. **Given** two connected plans, **When** an admin views workspace-level breakdowns, **Then** workspaces are grouped or labeled by their parent plan for disambiguation.

---

### User Story 5 - Sync Iterates All Active Plans (Priority: P3)

The existing sync framework (cron jobs, manual sync triggers, sync events tracking) is extended to iterate through all active plan connections. Each plan sync produces its own sync event record. If one plan's sync fails, the remaining plans continue unaffected. Sync status is displayed through the existing sync information UI — no additional per-plan sync status display is needed outside of the existing sync events.

**Why this priority**: Operational reliability — the sync must gracefully handle multiple plans without requiring new sync infrastructure or UI.

**Independent Test**: Can be tested by connecting two plans (one valid, one with a bad key), triggering a sync, and verifying the healthy plan syncs successfully while the failed plan's error is captured in sync events.

**Acceptance Scenarios**:

1. **Given** two active plan connections, **When** a scheduled or manual sync triggers, **Then** the system iterates through all active plans using the existing sync framework, creating sync event records for each.
2. **Given** a plan with an expired or revoked API key, **When** sync runs, **Then** that plan's sync event records the failure while other plans sync normally.
3. **Given** an admin viewing the existing sync status/history, **When** multiple plans have been synced, **Then** the sync events reflect each plan's sync outcome without requiring a separate per-plan sync status view.

---

### Edge Cases

- What happens when two plans have overlapping API key IDs? (API key IDs are globally unique within Anthropic, so this should not occur — but the system should detect and warn if it does.)
- How does the system handle a plan being disconnected while a sync is in progress? (The sync should complete for already-started plans; the disconnected plan is skipped on next run.)
- What happens when the same user has API keys in multiple connected plans? (Currently each user has one API key via license assignment. The system resolves against the first matching plan. Supporting multiple keys per user is out of scope.)
- What is the maximum number of connected plans? (Reasonable limit of 10 plans, sufficient for any organization's needs.)
- How does re-connecting a previously disconnected plan work? (Admin can add the same plan again; historical data from the previous connection is retained if the plan identifier matches.)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support connecting multiple Claude API plans simultaneously, each identified by a unique admin API key and a user-provided label.
- **FR-002**: System MUST store each plan connection with its label, encrypted admin API key, connection status (active/disconnected), and sync metadata.
- **FR-003**: System MUST resolve user API keys against all active connected plans during usage sync, matching the key to the correct plan.
- **FR-004**: System MUST track which plan each user's usage data originates from, associating usage metrics with a specific plan connection.
- **FR-005**: System MUST display user Claude API usage on the profile page and user detail page without requiring the user to know which plan their key belongs to.
- **FR-006**: System MUST show the plan label on the admin user detail page alongside usage data for cost attribution.
- **FR-007**: System MUST sync workspace metadata and costs independently for each connected plan.
- **FR-008**: System MUST integrate multi-plan syncing into the existing sync framework (sync events, sync locks, cron handlers), with each plan's sync outcome recorded as standard sync events — no separate per-plan sync status UI required.
- **FR-009**: System MUST allow admins to add, edit labels, and remove plan connections.
- **FR-010**: System MUST retain historical usage data when a plan is disconnected (soft delete).
- **FR-011**: System MUST NOT alter how budget views calculate or display costs — budget views remain driven by invoice/billed cost data only.
- **FR-012**: System MUST validate that a new plan connection's admin API key is not already in use by another active connection.
- **FR-013**: System MUST support manual sync triggers per-plan and for all plans simultaneously.
- **FR-014**: System MUST auto-import the existing environment-variable-based admin API key as the first plan connection on initial migration when no database plan connections exist.
- **FR-015**: System MUST migrate all existing historical usage metrics and workspace cost data to be associated with the auto-imported first plan connection, leaving no unassociated records.

### Key Entities

- **API Plan Connection**: Represents a connected Claude API plan. Attributes: label, encrypted admin API key, status (active/disconnected), creation date, last sync timestamps. One organization can have many plan connections.
- **Usage Metrics (extended)**: Existing per-user/per-day/per-model usage records, now additionally associated with the plan connection they were sourced from.
- **Workspace (extended)**: Existing workspace records, now additionally associated with the plan connection they belong to.
- **Sync Status (extended)**: Existing sync tracking, now scoped per plan connection rather than as a singleton.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Admins can connect and manage up to 10 Claude API plans within 2 minutes per plan.
- **SC-002**: User profile pages display correct usage data regardless of which connected plan their API key belongs to, with no visible difference from the current single-plan experience.
- **SC-003**: Admin user detail pages clearly identify the source plan for each user's usage data.
- **SC-004**: Workspace cost data from all connected plans is aggregated on the global Claude metrics dashboard with per-plan disambiguation.
- **SC-005**: A sync failure on one plan does not prevent other plans from syncing successfully.
- **SC-006**: Budget views (annual budgets, budget periods, billed costs) remain completely unaffected — zero changes to budget calculation or display.
- **SC-007**: Historical usage data is preserved when a plan connection is removed, ensuring no data loss.

## Clarifications

### Session 2026-03-27

- Q: What happens to the existing `ANTHROPIC_ADMIN_API_KEY` environment variable when multiple plans are supported? → A: Auto-import — on first run, if the env var exists and no database plan connections exist, the system automatically creates a plan connection from it. The env var can be removed afterward at the admin's convenience.
- Q: How should existing historical usage and workspace cost data (which has no plan reference) be handled after migration? → A: A migration script associates all existing data with the auto-imported first plan connection. No null plan references in the data model.

## Assumptions

- Each user has at most one Claude API key assigned (via license assignment). Supporting multiple keys per user is out of scope.
- Anthropic API key IDs are globally unique across organizations/plans.
- The existing encrypted API key storage mechanism in license assignments is sufficient and does not need changes.
- The current admin API key (used for org-level access in sync) will be stored per plan connection rather than as a single environment variable. On first run, the existing `ANTHROPIC_ADMIN_API_KEY` env var is auto-imported as the first plan connection if no DB plans exist yet.
- Plan connections are organization-wide settings managed only by admins.
- The automatic cron sync will iterate through all active plan connections.
