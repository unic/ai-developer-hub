# Feature Specification: GitHub Billing Sync

**Feature Branch**: `015-github-billing`
**Created**: 2026-03-10
**Status**: Draft
**Input**: User description: "GitHub billing information should be integrated for an automated sync. Billing data should be fetched from the API and automatically added to the correct budget periods. No invoice should be duplicated. The billing details also integrate into the dedicated github copilot dashboards. The goal is to have an automated workflow to keep track of budgets and reports with github invoices."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Automated GitHub Billing Sync to Budget Periods (Priority: P1)

As a budget administrator, I want GitHub billing data to be automatically fetched from the GitHub API and recorded as billed costs against the correct budget periods, so that my organization's GitHub spending is reflected in the main budget dashboards without manual data entry.

**Why this priority**: This is the core value proposition — eliminating manual tracking of GitHub costs and ensuring budget dashboards reflect actual GitHub spend. Without this, administrators must manually look up GitHub invoices and enter them, which is error-prone and time-consuming.

**Independent Test**: Can be fully tested by triggering a billing sync for a connected GitHub organization and verifying that billed cost entries appear in the corresponding budget periods on the main dashboard.

**Acceptance Scenarios**:

1. **Given** a GitHub organization is connected with billing sync enabled and budget periods exist covering the current month, **When** a billing sync runs, **Then** the system fetches the organization's billing data from the GitHub API and creates billed cost entries linked to the matching budget periods.
2. **Given** a billing sync has already recorded costs for a specific billing month, **When** the sync runs again for the same period, **Then** existing entries are updated (not duplicated) and the billed cost amounts reflect the latest data from GitHub.
3. **Given** budget periods exist but none covers a particular GitHub billing month, **When** the sync encounters billing data for that month, **Then** the system records the billing snapshot but does not create a billed cost entry, and logs a warning that no matching budget period was found.
4. **Given** no GitHub organization is connected or billing sync is not enabled, **When** a user navigates to billing settings, **Then** the system displays clear instructions on how to enable GitHub billing sync.

---

### User Story 2 - Deduplication and Idempotent Sync (Priority: P1)

As a budget administrator, I want the billing sync to be fully idempotent so that running it multiple times never creates duplicate billed cost entries, ensuring my budget data remains accurate.

**Why this priority**: Data integrity is non-negotiable. Duplicate billing entries would corrupt budget calculations and erode trust in the system. This is a foundational requirement that underpins all other stories.

**Independent Test**: Can be fully tested by running a billing sync twice for the same period and verifying that billed cost entries are not duplicated — same count, same amounts.

**Acceptance Scenarios**:

1. **Given** a billing sync has already created billed costs for January 2026, **When** I run the sync again, **Then** the existing billed cost entries are updated in place and no new entries are created for January 2026.
2. **Given** GitHub reports an updated amount for a previously synced month (e.g., mid-month adjustment), **When** the sync runs, **Then** the corresponding billed cost entry is updated to reflect the new amount and the change is recorded in history.
3. **Given** a billed cost entry was manually created by an administrator for a GitHub billing month, **When** the sync runs, **Then** the system skips that month, does not overwrite the manual entry, and flags a conflict for the administrator to review.

---

### User Story 3 - Copilot Dashboard Billing Integration (Priority: P2)

As a budget administrator, I want the Copilot billing dashboard to display both the Copilot-specific billing snapshots and the linked budget cost entries, so that I can see Copilot spending in the context of my overall budget allocation.

**Why this priority**: The Copilot dashboards already show billing snapshots (from feature 013/014), but they lack connection to the budget system. Bridging this gap provides a unified view of Copilot costs within the broader financial picture.

**Independent Test**: Can be fully tested by navigating to the Copilot billing dashboard after a sync and verifying that each billing month shows both the snapshot amount and the linked budget period status.

**Acceptance Scenarios**:

1. **Given** a Copilot billing sync has run and billed costs are linked to budget periods, **When** I view the Copilot billing dashboard, **Then** each billing month row shows the linked budget period name and the budget utilization percentage.
2. **Given** a Copilot billing snapshot exists but no budget period covers that month, **When** I view the Copilot billing dashboard, **Then** that row displays an "Unlinked" indicator with a tooltip explaining why.
3. **Given** Copilot billing data is linked to budget periods, **When** I view the main reports page, **Then** Copilot costs appear in spend trend charts and budget vs. actual comparisons alongside other vendor costs.

---

### User Story 4 - Manual Billing Sync Trigger and Status Visibility (Priority: P2)

As a budget administrator, I want to manually trigger a GitHub billing sync and see the status of past syncs, so that I can ensure billing data is up-to-date and troubleshoot any issues.

**Why this priority**: Administrators need confidence that the automated sync is working correctly and the ability to force a refresh when needed (e.g., after a billing correction on GitHub's side).

**Independent Test**: Can be fully tested by clicking a "Sync Now" button, watching the sync progress indicator, and reviewing the sync history log.

**Acceptance Scenarios**:

1. **Given** I am on the GitHub billing settings page, **When** I click "Sync Billing Now", **Then** a billing sync starts immediately and the UI shows a progress indicator until completion.
2. **Given** a billing sync has completed, **When** I view the sync history, **Then** I see the sync timestamp, status (completed/partial/failed), number of billing months processed, and number of billed cost entries created or updated.
3. **Given** a sync fails due to an API error (rate limit, auth failure), **When** I view the sync result, **Then** the error is clearly described with guidance on how to resolve it.

---

### User Story 5 - Scheduled Automatic Billing Sync (Priority: P3)

As a budget administrator, I want the system to automatically sync GitHub billing data on a regular schedule, so that budget dashboards stay current without requiring manual intervention.

**Why this priority**: Automation is the end goal, but manual sync (P2) provides immediate value. Scheduled sync builds on top of the manual mechanism and is less critical for initial delivery.

**Independent Test**: Can be fully tested by configuring a sync schedule, advancing past the scheduled time, and verifying that billing data was fetched and recorded without manual intervention.

**Acceptance Scenarios**:

1. **Given** billing sync is enabled for a GitHub organization, **When** the configured sync interval elapses (default: daily), **Then** the system automatically fetches and processes the latest billing data.
2. **Given** automatic sync is configured, **When** the scheduled sync encounters a transient error, **Then** the system retries once after a delay and records the outcome in sync history.
3. **Given** automatic sync is running, **When** an administrator triggers a manual sync simultaneously, **Then** the system prevents duplicate execution and notifies the administrator that a sync is already in progress.

---

### Edge Cases

- What happens when a GitHub organization's billing currency differs from the budget currency? The system assumes all amounts are in the same currency (USD) as configured in the budget. Currency conversion is out of scope.
- What happens when a GitHub connection's access token expires or is revoked mid-sync? The sync fails gracefully, records the error, and the administrator is notified to re-authenticate.
- What happens when budget periods are restructured (e.g., changed from monthly to quarterly) after billing data has been synced? Existing billed cost entries retain their links. New syncs match against the current period structure.
- What happens when a GitHub organization has multiple billing products (Copilot, Actions, Packages, etc.)? This release syncs Copilot billing only. The vendor reference format (e.g., "github-billing-copilot-2026-01") includes the product name, so future products can be added without conflicting with existing entries.
- What happens when the GitHub billing API returns partial data (e.g., current month in progress)? The system records the partial amount and updates it on the next sync when more complete data is available.
- What happens when a billed cost linked to a GitHub billing month is manually deleted by an administrator? The next sync recreates it, since the vendor reference no longer matches an existing entry.

## Clarifications

### Session 2026-03-10

- Q: Should this feature sync multiple GitHub billing products (Copilot, Actions, Packages) or focus on Copilot only? → A: Copilot-only for now; design for extensibility but do not implement other products.
- Q: When billing sync is first enabled, how far back should the system fetch billing history? → A: Last 12 months of billing history.
- Q: When a manual billed cost entry already exists for a GitHub billing month, should the sync overwrite it? → A: Sync skips the month and flags a conflict for admin review.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST fetch billing data from the GitHub billing API for connected organizations when sync is triggered (manually or on schedule). On initial sync, the system MUST backfill up to 12 months of billing history. Subsequent syncs fetch only new or updated months.
- **FR-002**: System MUST match each billing record to the correct budget period based on the billing date and period date ranges.
- **FR-003**: System MUST create billed cost entries linked to matching budget periods, using a unique vendor reference per billing month and product to prevent duplicates.
- **FR-004**: System MUST update existing billed cost entries when the same billing period is synced again (upsert behavior), never creating duplicates.
- **FR-005**: System MUST record a descriptive vendor reference for each billed cost entry (e.g., "github-billing-copilot-2026-01") to enable deduplication and traceability.
- **FR-006**: System MUST display Copilot billing data on the Copilot billing dashboard with links to associated budget periods when available.
- **FR-007**: System MUST include GitHub billing costs in main dashboard KPIs, budget utilization charts, and reports when linked to budget periods.
- **FR-008**: System MUST log each billing sync operation with status, counts, and error details in the sync event history.
- **FR-009**: System MUST allow administrators to manually trigger a billing sync from the settings or Copilot billing page.
- **FR-010**: System MUST support scheduled automatic billing sync at a configurable interval (default: daily).
- **FR-011**: System MUST prevent concurrent sync executions for the same organization to avoid race conditions and duplicates.
- **FR-012**: System MUST handle GitHub API errors (rate limits, authentication failures, timeouts) gracefully and report them clearly to the administrator.
- **FR-013**: System MUST skip billing months that have no matching budget period, recording a warning rather than failing the entire sync.
- **FR-015**: System MUST detect when a manually created billed cost entry exists for the same billing month and vendor reference pattern. In that case, the sync MUST skip that month and surface a conflict notification to the administrator, preserving the manual entry.
- **FR-014**: System MUST sync Copilot billing data only for this release. The sync architecture MUST be extensible to support additional GitHub products (Actions, Packages, etc.) in future releases without requiring schema changes.

### Key Entities

- **GitHub Billing Record**: A monthly billing entry from the GitHub API representing charges for a specific product (e.g., Copilot, Actions) for an organization. Key attributes: billing month, product name, amount, seat count (where applicable).
- **Billed Cost (existing)**: An actual spending entry linked to a budget period. Extended with GitHub-specific vendor references to enable deduplication.
- **Copilot Billing Snapshot (existing)**: Monthly Copilot-specific billing data stored independently. Extended with a reference to the linked billed cost entry for cross-navigation.
- **Sync Event (existing)**: A record of a sync operation. Extended to track billing-specific metrics (months processed, entries created/updated, entries skipped).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Administrators can set up GitHub billing sync in under 5 minutes from the settings page.
- **SC-002**: Billing data from GitHub appears in the correct budget periods within 1 sync cycle, with zero manual data entry required.
- **SC-003**: Running the billing sync multiple times for the same period produces identical results (zero duplicate entries).
- **SC-004**: 100% of synced GitHub billing months that overlap with configured budget periods are reflected in main dashboard KPIs and reports.
- **SC-005**: Sync failures are surfaced to the administrator within 10 seconds of occurrence, with actionable error messages.
- **SC-006**: The Copilot billing dashboard shows budget context (linked period, utilization) for every synced billing month that has a matching budget period.
- **SC-007**: Scheduled syncs execute reliably without administrator intervention, keeping billing data no more than 24 hours stale (at default daily schedule).

## Assumptions

- GitHub billing API endpoints provide monthly billing data per product. The system will use the Copilot billing endpoint (already integrated) and extend to other products as the GitHub billing API exposes them.
- All monetary amounts from GitHub are in USD and match the budget system's currency. Currency conversion is out of scope.
- The existing GitHub connection and token management infrastructure (encryption, scope validation) is reused without modification.
- The existing sync event tracking and stale-run cleanup patterns are reused.
- Feature 014's decoupling is intentionally reversed for Copilot billing — this feature re-establishes the link between Copilot billing snapshots and the shared billed costs table, but through a more robust, idempotent mechanism.
- Budget periods are configured by the administrator before billing sync can link costs. The system does not auto-create budget periods.
