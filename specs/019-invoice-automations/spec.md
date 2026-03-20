# Feature Specification: Invoice Automations & Running Cost Visibility

**Feature Branch**: `019-invoice-automations`
**Created**: 2026-03-20
**Status**: Draft
**Input**: User description: "the application is intended to integrated GitHub Copilot, Claude Team Plan and Claude API Plan. For github and claude team plan, i get multiple invoices a month. I want them automatically added to the application and linked to the correct budget periods. multiple imports or sync should not duplicate entries. The claude api plan is different, because you need to add credits beforehand. This makes planning hard. Instead, the total token costs of the months should be added and updated. This should also be visible from the UI, that it's not billed costs, but running costs. Existing sync features should be either refactored or replaced completely. There should be a clean, unified approach to this."

## Overview

The application currently has multiple independent sync mechanisms built across several features (Copilot billing sync, GitHub member sync, Anthropic API usage sync, invoice-to-period sync). Each was built in isolation with its own locking strategy, event logging table, scheduling approach, and status tracking. This feature replaces all of them with a single unified sync framework, then builds the new invoice automation capabilities on top of that framework. GitHub Copilot invoices are pulled automatically via the existing GitHub connection. Claude Team Plan invoices have no programmatic API; the existing invoice upload and auto-linking feature is reused as-is for manual uploads and extended with an authenticated ingestion endpoint so external automations can submit invoices without administrator involvement. Claude API costs are tracked as running token consumption rather than invoiced amounts.

## Clarifications

### Session 2026-03-20

- Q: How does the application obtain Claude Team Plan invoices — via a programmatic billing API, or another method? → A: No billing API exists. The existing invoice upload and auto-linking feature is used as-is for manual uploads, and extended with an authenticated ingestion endpoint so external automations can submit invoices programmatically.
- Q: When an external API call fails during a sync, what should the system do? → A: Retry with exponential backoff within the same sync run; mark the sync as failed with a human-readable error if retries are exhausted.
- Q: Where are external API credentials (GitHub token, Anthropic API key) stored? → A: Environment variables / deployment secrets only — not persisted in the database.
- Q: Which sources should support backfill? → A: API-driven sources only (GitHub Copilot billing, Anthropic API usage). Claude Team Plan has no API; historical invoices are handled via the normal upload flow, not a dedicated backfill mode.
- Q: What is the lifecycle of an unlinked billing record? → A: Retained indefinitely — an administrator must explicitly resolve (link to a period) or delete the record. No automatic expiry.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Unified Sync Framework Replacing All Existing Syncs (Priority: P1)

An administrator wants all automated data synchronization across the application to behave consistently — the same scheduling model, the same status display, the same locking behavior, and the same audit trail — regardless of whether the sync is for GitHub Copilot billing, Anthropic API usage, member data, or invoice matching.

**Why this priority**: All subsequent user stories depend on this foundation. The current state has four independent sync mechanisms with inconsistent behavior, separate event tables, and no shared observability. Building more syncs on top of the existing structure would compound the inconsistency. This must be resolved first.

**Independent Test**: Can be tested by verifying that all previously independent syncs (GitHub Copilot billing, GitHub member data, Anthropic API usage, invoice-to-period matching) now appear as registered sources in a single sync registry with a unified status view, and that triggering any of them produces a standardized sync event record.

**Acceptance Scenarios**:

1. **Given** the unified sync framework is in place, **When** any sync type runs (regardless of source), **Then** a standardized sync event record is created with consistent fields: source identifier, start time, end time, outcome, counts of created/updated/skipped records, and any error message.
2. **Given** two different syncs are triggered simultaneously, **When** one is already in progress, **Then** the second is rejected with a consistent "sync in progress" response — regardless of sync type.
3. **Given** an administrator views the sync status dashboard, **When** looking at all registered sync sources, **Then** all sources (GitHub Copilot, GitHub members, Anthropic API usage, invoice matching, Claude Team Plan) appear in a single unified list with identical status fields.
4. **Given** an existing sync type that previously had its own status table (e.g., Anthropic sync status), **When** the unified framework is deployed, **Then** that source's status is served from the unified event log, and the previous dedicated status table is no longer the source of truth.

---

### User Story 2 - GitHub Copilot Invoice Auto-Sync (Priority: P2)

An administrator wants GitHub Copilot invoices to be automatically pulled into the application and linked to the correct monthly budget period — without any manual work and without creating duplicate entries on repeated syncs.

**Why this priority**: GitHub Copilot billing is the most frequently used external billing source. Automating it eliminates recurring admin effort every billing cycle and demonstrates the unified framework's invoice sync capability.

**Independent Test**: Can be tested by triggering the GitHub Copilot invoice sync and confirming new invoice entries appear under the correct budget period, then triggering sync a second time and confirming no duplicates are created.

**Acceptance Scenarios**:

1. **Given** a connected GitHub organization with pending Copilot billing records, **When** the invoice sync runs (scheduled or manual), **Then** each billing record is created as a billed cost entry linked to the matching monthly budget period.
2. **Given** a Copilot invoice already imported in a previous sync, **When** the sync runs again, **Then** no duplicate billed cost entry is created for that invoice.
3. **Given** a Copilot billing record whose date does not fall within any active budget period, **When** the sync runs, **Then** the record is stored in an unlinked state and the sync report surfaces it for reconciliation.
4. **Given** multiple Copilot invoices issued within the same calendar month, **When** the sync runs, **Then** each invoice is treated as a separate billed cost entry (not merged), all linked to the same budget period.
5. **Given** an already-imported Copilot invoice whose amount was corrected at source, **When** the sync runs, **Then** the existing entry is updated and no duplicate is created.

---

### User Story 3 - Claude Team Plan Invoice Processing via Upload or External Automation (Priority: P3)

Since Anthropic provides no billing API for Claude Team Plan, the application extends its existing invoice upload and auto-linking feature to also accept invoice submissions from external automations (e.g., an email forwarding rule, a Zapier/Make workflow, or a custom script). Either path — manual upload by an administrator or programmatic submission by an external tool — feeds into the same processing pipeline: field extraction, deduplication, and automatic budget period linking.

**Why this priority**: Claude Team Plan invoices arrive by email. The existing upload feature already handles parsing and linking; the only missing piece is an ingestion endpoint that lets an external automation submit invoices without administrator involvement. This closes the automation gap without building a new processing pipeline.

**Independent Test**: Can be tested in two ways: (1) manually uploading a Claude Team Plan PDF and confirming it is parsed, linked, and deduplicated using the existing flow; (2) submitting the same PDF via the external automation endpoint and confirming the identical outcome — without the administrator visiting the upload UI.

**Acceptance Scenarios**:

1. **Given** an administrator uploads a Claude Team Plan invoice PDF via the existing upload UI, **When** the application processes it, **Then** the existing extraction, deduplication, and period-linking pipeline handles it — no new manual steps are required.
2. **Given** an external automation submits a Claude Team Plan invoice (PDF or structured data) to the ingestion endpoint, **When** the application receives it, **Then** the same extraction, deduplication, and period-linking pipeline processes it automatically, without any administrator action.
3. **Given** a Claude Team Plan invoice already present in the system, **When** the same invoice is submitted again (via either path), **Then** no duplicate billed cost entry is created; the duplicate is detected by invoice number.
4. **Given** multiple Claude Team Plan invoices submitted in a single month, **When** each is processed, **Then** each creates a separate billed cost entry linked to the same budget period.
5. **Given** an invoice submitted via the external automation endpoint with an invalid or missing authentication token, **When** the application receives it, **Then** the submission is rejected and no invoice is created.

---

### User Story 4 - Claude API Running Costs in Budget View (Priority: P4)

An administrator wants to see the accumulated Claude API token costs for the current month alongside regular billed costs in the budget period view — clearly distinguished as "running costs" rather than invoiced amounts — so they can monitor API spend in real time and plan accordingly.

**Why this priority**: The Claude API uses a prepaid credit model with no per-month invoice. Without running cost visibility at the budget level, administrators cannot tell whether API spend is on track. The existing per-user profile view is insufficient — the need is at the period level.

**Independent Test**: Can be tested by viewing any budget period overlapping with the current month and confirming a "Running Costs" entry appears for Claude API with the correct aggregated amount, clearly visually distinct from billed cost line items.

**Acceptance Scenarios**:

1. **Given** a budget period containing days in the current or a past month, **When** the administrator views the period's cost breakdown, **Then** Claude API running costs for that period's date range are displayed as a separate "Running Costs" entry, visually distinct from billed cost entries.
2. **Given** new API usage is recorded since the last sync, **When** the administrator views the budget period, **Then** the running cost total reflects the latest accumulated amount (as of the last Anthropic usage sync).
3. **Given** a budget period with no Claude API activity, **When** viewing that period, **Then** no running cost entry is shown (zero-value entries are omitted).
4. **Given** a period with both regular billed costs and Claude API running costs, **When** viewing period totals, **Then** the totals clearly separate billed costs from running costs, with a combined total also available.
5. **Given** a budget period that has ended, **When** viewing it, **Then** the Claude API running cost shown is the final accumulated total for that period's date range.

---

### User Story 5 - Historical Data Backfill on Launch (Priority: P5)

When setting up the application for the first time, an administrator wants to import historical billing and usage data from API-driven sources (GitHub Copilot billing and Anthropic API usage) going back to a chosen start date — so that past budget periods are populated and reports reflect the full picture from day one. Claude Team Plan historical invoices are handled through the normal upload flow and do not require a dedicated backfill mode.

**Why this priority**: Without backfill, the application launches with empty historical periods for API-driven sources. Budget reports and cost comparisons are meaningless until enough real-time data has accumulated, which could take months. Backfill allows the application to be immediately useful from day one.

**Independent Test**: Can be tested by configuring a backfill start date for GitHub Copilot or Anthropic API usage, triggering the backfill, and confirming that historical records appear in the correct past budget periods without duplicating any records that may have already been imported by a regular sync.

**Acceptance Scenarios**:

1. **Given** a freshly configured source with no previously synced data, **When** the administrator triggers a backfill with a chosen start date, **Then** all available historical records from that start date to the present are imported and linked to their respective budget periods.
2. **Given** a source that has already had some data imported via regular sync, **When** a backfill is triggered for an overlapping date range, **Then** no duplicate entries are created — the same idempotency rules as regular sync apply.
3. **Given** a backfill covering multiple budget periods, **When** the backfill completes, **Then** each imported record is linked to the correct budget period based on its date, not the date the backfill ran.
4. **Given** a backfill in progress, **When** a regular scheduled sync for the same source is due, **Then** the scheduled sync is deferred until the backfill completes, consistent with the mutual exclusion rule.
5. **Given** a partial backfill failure (e.g., the source API returns an error mid-way), **When** the administrator retriggers the backfill, **Then** already-imported records are not duplicated and the operation resumes from the point of failure.

---

### User Story 6 - Unified Sync Status Dashboard (Priority: P6)

An administrator wants a single place to see the status of all automated syncs — last run time, outcome, record counts, and any errors — so they can confirm automations are healthy without inspecting individual feature pages or log files.

**Why this priority**: As the number of registered sync sources grows, scattered status indicators become unmanageable. A unified dashboard is the natural complement to the unified sync framework.

**Independent Test**: Can be tested by navigating to the sync status page and confirming all sources appear with consistent status fields, and that triggering a manual sync updates the status in the same view.

**Acceptance Scenarios**:

1. **Given** one or more completed sync runs, **When** the administrator views the sync dashboard, **Then** all registered sources appear with last run time, outcome (success/partial/failure), and record counts (created/updated/skipped).
2. **Given** a sync that encountered an error, **When** viewing that source's status, **Then** the error is surfaced with a human-readable description.
3. **Given** a source that has never been synced, **When** viewing sync status, **Then** it shows "Never synced" rather than an empty or broken state.
4. **Given** any registered sync source, **When** the administrator manually triggers a sync from the dashboard, **Then** the sync runs and the status updates upon completion.
5. **Given** an API-driven source (GitHub Copilot billing or Anthropic API usage), **When** the administrator initiates a backfill from the dashboard with a chosen start date, **Then** the backfill is queued and its progress is visible in the same status view as regular syncs.

---

### Edge Cases

- What happens when a GitHub Copilot billing record has an amount of zero (e.g., a trial period)? → Zero-amount entries are still created to maintain a complete audit trail.
- What happens if a Claude Team Plan invoice is re-uploaded with a corrected amount? → The existing entry is updated based on the matching invoice number; no duplicate is created.
- What happens when Claude API running costs are computed from partial data (sync still mid-run)? → The displayed amount reflects data from the last completed sync, with a "last updated" timestamp shown alongside.
- What happens if two sync operations for any source are triggered simultaneously? → Only one proceeds; the second is rejected with a consistent "sync already in progress" message from the unified framework.
- What happens when an external API is unavailable or returns an error mid-sync? → The system retries with exponential backoff within the same run. If retries are exhausted, the sync is marked failed and the next scheduled run will attempt again.
- What happens when an invoice date cannot be matched to any budget period? → The invoice is stored in an unlinked state, retained indefinitely, and surfaced in a reconciliation view. An administrator must explicitly link it to a period or delete it — no automatic expiry occurs.
- What happens to Claude API running costs when a user is removed from the application? → Historical cost data is retained; running cost totals for past periods are unaffected.
- What happens to existing sync event data recorded by the old per-feature mechanisms? → Existing records are migrated to the unified event log during deployment; no historical data is lost.

## Requirements *(mandatory)*

### Functional Requirements

**Unified Sync Framework**

- **FR-001**: All existing sync mechanisms (GitHub Copilot billing, GitHub member sync, Anthropic API usage sync, invoice-to-period matching) MUST be refactored or replaced to operate through a single unified sync framework.
- **FR-002**: The unified sync framework MUST provide a consistent sync event record structure for all source types: source identifier, start time, end time, outcome, counts (created/updated/skipped/errors), and optional error message.
- **FR-003**: The unified sync framework MUST enforce mutual exclusion per source — only one active sync per source at any time — using a consistent locking mechanism across all source types.
- **FR-004**: The unified sync framework MUST support both scheduled execution and manual trigger for any registered sync source, with each source configured independently on its own schedule (e.g., hourly for API usage, daily for billing invoices, weekly for member data).
- **FR-005**: Any dedicated sync status tables introduced by previous features (e.g., per-feature sync status tables) MUST be superseded by the unified event log; data from those tables MUST be migrated.

**Invoice Automation**

- **FR-006**: The system MUST automatically import GitHub Copilot billing records and create idempotent billed cost entries linked to the matching budget period, using the unified sync framework.
- **FR-007**: Claude Team Plan invoices MUST be processed through the existing invoice upload and auto-linking pipeline. The system MUST extend this pipeline with an authenticated ingestion endpoint so that external automations (e.g., email forwarding services, scripts) can submit invoices programmatically without administrator involvement. Both the manual upload UI and the ingestion endpoint MUST produce identical outcomes: field extraction, deduplication by invoice number, and automatic budget period linking.
- **FR-008**: Both GitHub Copilot and Claude Team Plan sync operations MUST use a stable external identifier per record to prevent duplicate billed cost entries across repeated sync runs.
- **FR-009**: If an already-imported billing record is updated at source (e.g., amount corrected), the system MUST update the existing entry rather than creating a new one.
- **FR-010**: When an invoice's billing date cannot be matched to any budget period, the record MUST be stored in an unlinked state and surfaced for manual reconciliation. Unlinked records are retained indefinitely until an administrator explicitly links them to a budget period or deletes them. No automatic expiry applies.

**Running Costs**

- **FR-011**: The system MUST aggregate Claude API token costs by budget period date range and surface the total as a distinct "running cost" value in the budget period view.
- **FR-012**: Budget period views MUST clearly differentiate between billed costs (invoiced amounts) and running costs (accumulated token consumption), using distinct visual labels and treatments.
- **FR-013**: Budget period totals MUST present billed cost totals, running cost totals, and a combined total separately.
- **FR-014**: The Claude API running cost figure MUST include a "last updated" timestamp reflecting when the underlying usage data was last synced.

**Backfill**

- **FR-017**: The unified sync framework MUST support a backfill mode for API-driven sources (GitHub Copilot billing, Anthropic API usage), allowing an administrator to import historical records from a specified start date up to the present. Claude Team Plan historical invoices are imported via the normal upload flow and do not require a dedicated backfill mode.
- **FR-018**: Backfill operations MUST apply the same idempotency rules as regular sync — records already present are updated, not duplicated, regardless of whether they were imported by a prior backfill or a regular sync.
- **FR-019**: Each imported record during backfill MUST be linked to the budget period matching its original date, not the date the backfill ran.
- **FR-020**: A backfill and a regular sync for the same source MUST NOT run concurrently; the mutual exclusion rule applies across both operation types.
- **FR-021**: If a backfill is interrupted, a subsequent backfill run for the same source and date range MUST be resumable without duplicating already-imported records.

**Observability**

- **FR-015**: A unified sync status view MUST display all registered sync sources with consistent status fields: last run time, outcome, and record counts.
- **FR-016**: Sync errors MUST be surfaced with human-readable descriptions; raw error codes or stack traces MUST NOT be shown to administrators.
- **FR-022**: When an external API call fails during a sync, the system MUST retry with exponential backoff within the same sync run. If all retries are exhausted, the sync MUST be marked as failed and the error recorded in the sync event log.
- **FR-023**: All external API credentials (GitHub token, Anthropic API key) MUST be supplied as environment variables or deployment secrets. The system MUST NOT store credentials in the database or expose them in any UI or sync event log output.
- **FR-024**: The invoice ingestion endpoint MUST require authentication (e.g., a pre-shared secret token) to prevent unauthorized invoice submissions. Unauthenticated requests MUST be rejected.

### Key Entities

- **Sync Source**: A registered sync source within the unified framework — identified by a stable source type (e.g., `github_copilot_billing`, `anthropic_team_invoices`, `anthropic_api_usage`, `github_members`, `invoice_period_matching`), with enabled state, its own independently configured schedule, and last known status.
- **Sync Event**: A record of a single sync execution — source type, start/end timestamps, outcome (success/partial/failure), counts (created/updated/skipped/errors), and optional structured error detail. Replaces all per-feature sync event/status tables.
- **Billed Cost**: An invoiced charge linked to a budget period. Requires an `externalId` field (source + unique record identifier) to support idempotent upserts from automated sync.
- **Running Cost**: A computed aggregate of token consumption costs for a budget period's date range — derived from usage metrics, not stored as a separate record. Surfaced alongside billed costs in the period view.
- **Unlinked Billing Record**: A billing record imported from an external source that could not be matched to any budget period — held for manual reconciliation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All previously independent sync mechanisms are consolidated — zero separate sync status tables remain as the authoritative source; all sync events flow through the unified log.
- **SC-002**: GitHub Copilot invoices are available in the application within 24 hours of being issued, without administrator intervention. Claude Team Plan invoices are available within minutes of being uploaded or forwarded, without manual field entry.
- **SC-003**: Triggering any sync twice in succession, or uploading the same invoice twice, results in zero duplicate billed cost entries — idempotency rate is 100%.
- **SC-004**: An administrator can view the sync status of all data sources in a single view without navigating between multiple pages.
- **SC-005**: The budget period view clearly labels billed costs and running costs such that a new administrator can distinguish the two categories without consulting documentation.
- **SC-006**: Sync operations complete within 60 seconds for a typical month's worth of billing data per source.
- **SC-007**: Zero manual field entry is required for recurring GitHub Copilot charges once configured, and zero manual field entry is required for Claude Team Plan invoices once uploaded or forwarded.
- **SC-008**: No historical sync event data is lost during migration from the old per-feature tables to the unified event log.

## Assumptions

- Anthropic does not expose a programmatic billing API for Claude Team Plan invoices. Invoices are delivered by email. The existing invoice upload and auto-linking feature handles parsing and period-linking; this feature extends it with an authenticated ingestion endpoint for programmatic submission by external automations (e.g., an email forwarding rule).
- GitHub Copilot billing records accessible via the existing GitHub connection are sufficient to serve as the data source for invoice auto-import; no additional GitHub OAuth scopes are required beyond what is already granted.
- Claude API running costs are computed from usage metrics already collected by the Anthropic API usage sync; no new external data pipeline is required.
- A "budget period" is always date-bounded; invoice-to-period matching uses the invoice issue date (not due date or payment date).
- The application has a single active annual budget at any time for period-matching purposes; archived budgets serve as fallback.
- Each sync source has its own independently configured schedule suited to its update frequency — for example, Anthropic API usage runs hourly, billing invoice sources run daily, and member data runs weekly. These are defaults and should be configurable.
- Existing sync event records in per-feature tables are structurally compatible enough with the unified event model to be migrated without data loss; lossy mapping fields can be defaulted.
- Running costs for closed budget periods are considered final once the period ends and the last usage sync covering that period has completed.
