# Feature Specification: GitHub Copilot Integration

**Feature Branch**: `013-github-copilot-integration`
**Created**: 2026-03-09
**Status**: Draft
**Input**: User description: "I want to add a GitHub Copilot integration to the application. The integration can pull relevant Copilot metrics into the application and provides multiple dashboards to visualize it. It should integrate organization level data, seat allocation, user data and user details, as well as cost and billing information. The goal is to see usage pattern, status, utilization and costs. Also, it allows to keep analytics data beyond the API's limitation of 100 days."

## Integration Strategy

This feature integrates with the existing application through two complementary channels:

1. **Generic data flows through existing systems**: Copilot seats become license assignments in the existing `licenseAssignments` model. Copilot billing becomes billed cost entries in the existing `billedCosts` model. This means existing dashboards (main dashboard KPIs, Reports page, Budget detail) automatically reflect Copilot data without modification.

2. **Copilot-specific analytics live in an isolated space**: Metrics unique to Copilot (suggestion counts, acceptance rates, language/editor breakdowns) are stored in dedicated tables and rendered in dedicated pages under `/copilot/*`. These pages never modify or interfere with existing features.

### Existing Assets Reused

- **GitHub connection infrastructure** (`githubConnections`, `githubProfiles`, `githubSyncEvents` tables, `src/lib/github.ts` API wrapper, `src/lib/crypto.ts` token encryption) — the Copilot integration extends the existing GitHub organization connection rather than creating a separate one.
- **AI Tools & Access Tiers model** (`aiTools`, `accessTiers` tables) — GitHub Copilot is represented as an AI Tool with tiers (e.g., Business, Enterprise), auto-created during the first Copilot sync.
- **License Assignments model** (`licenseAssignments` table) — Copilot seat assignments are synced as license assignments, appearing in the existing `/assignments` table and `/tools` detail page.
- **Billed Costs & Budget model** (`billedCosts`, `budgetPeriods` tables) — Copilot billing data creates billed cost entries linked to existing budget periods, flowing into existing variance analysis and forecasting.
- **Reports infrastructure** (`src/components/reports/*`, `src/actions/budget.ts` report queries) — Copilot costs and license counts are automatically included in existing report aggregations.
- **Settings integrations page** (`/settings/integrations`) — Copilot configuration is added as a new section on the existing integrations page, not a separate page.
- **Sync event tracking** (`githubSyncEvents` table) — extended with a sync type discriminator to track Copilot-specific sync operations alongside existing member syncs.
- **Data table infrastructure** (`src/components/data-table.tsx`, faceted filters, column headers) — the Copilot seat allocation view reuses the same table patterns.
- **Chart infrastructure** (`src/components/ui/chart.tsx`, Recharts + ChartContainer pattern) — Copilot dashboards use the same chart wrapper, tooltip, and legend components.
- **Change history** (`changeHistory` table) — Copilot sync operations that modify license assignments or tool entries are recorded in the existing audit trail.

### Isolation Boundaries

- New pages live exclusively under `/copilot/*` — no modifications to existing page components.
- New database tables (`copilotUsageMetrics`, `copilotBillingSnapshots`) are additive — no columns added to or removed from existing tables.
- A `source` discriminator on license assignments distinguishes sync-managed records (read-only in the UI) from manually created ones, preventing accidental edits to synced data while keeping it visible everywhere.
- The existing `githubSyncEvents` table is extended with a sync type field rather than creating a parallel tracking mechanism.
- Sidebar navigation adds a single "Copilot" entry (admin-only) as a peer to existing items — no restructuring of existing navigation.

## Clarifications

### Session 2026-03-09

- Q: What does the per-user detail view (`/copilot/seats/[userId]`) show — estimated suggestion/acceptance metrics or only actual per-seat API data? → A: Only actual per-seat data (assignment date, last activity, status, plan type, activity timeline). Suggestion/acceptance counts are org-level aggregates shown on overview and analytics dashboards only.
- Q: How do users navigate between Copilot sub-pages (overview, seats, billing, analytics)? → A: Tab bar within the `/copilot` layout, matching the existing Reports page pattern.
- Q: What happens when an admin disables Copilot syncing? → A: All data persists (AI Tool, assignments, billed costs, metrics remain). Only scheduled syncing stops. Admin can re-enable later.
- Q: What happens when Copilot billing syncs but no active budget exists? → A: Copilot billing snapshots are always stored. Billed cost entries in the budget model are only created when a matching budget period exists. Backfill occurs when a budget is later created.
- Q: What happens when a manual sync is triggered while a scheduled sync is already running? → A: Mutual exclusion. New sync requests are rejected with a "Sync already in progress" message. The "Sync Now" button shows disabled state during active sync.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Enable Copilot Data Sync on Existing GitHub Connection (Priority: P1)

As an administrator, I want to enable Copilot data syncing for my already-connected GitHub organization so that Copilot metrics are automatically pulled and stored for analysis.

The admin navigates to the existing integrations settings page (`/settings/integrations`). If a GitHub organization is already connected, the page shows a new "Copilot Data" section indicating whether the current token has Copilot-related permissions. If permissions are sufficient, the admin enables Copilot syncing with a single toggle. If the token lacks Copilot permissions, the system displays which additional scopes are needed and provides guidance to update the token. Once enabled, the system performs an initial data sync pulling all available Copilot data (up to the API's 28-day metrics window) and stores it locally. This initial sync auto-creates a "GitHub Copilot" AI Tool entry with appropriate access tiers, syncs seat assignments as license assignments, and imports billing data as billed cost entries linked to existing budget periods. After the initial sync, the system periodically syncs new data on a configurable schedule (default: daily). The admin can also trigger a manual sync at any time.

If no GitHub organization is connected yet, the admin first completes the existing GitHub connection flow, then enables Copilot syncing as a second step.

**Why this priority**: This is the foundational story — no dashboards or analytics work without a connected data source and stored metrics. It must also establish the bridge between Copilot data and the existing tools/assignments/budget models.

**Independent Test**: Can be fully tested by enabling Copilot sync on an existing GitHub connection and verifying that: (a) a "GitHub Copilot" AI Tool with tiers appears in `/tools`, (b) seat assignments appear in `/assignments`, (c) billing entries appear in the active budget's billed costs, and (d) Copilot-specific usage metrics are stored.

**Acceptance Scenarios**:

1. **Given** an admin on the integrations settings page with an active GitHub connection, **When** the token has Copilot permissions, **Then** the system displays a "Copilot Data" section with an enable toggle and scope confirmation.
2. **Given** an admin enables Copilot syncing, **When** the initial sync runs, **Then** the system: (a) creates or updates a "GitHub Copilot" AI Tool entry with access tiers matching Copilot plan types, (b) creates license assignments for each Copilot seat holder linked to matched application users via GitHub profiles, (c) creates billed cost entries for available billing periods, and (d) stores Copilot-specific usage metrics (suggestions, acceptances, language/editor breakdowns).
3. **Given** Copilot syncing is enabled, **When** the scheduled sync interval elapses, **Then** the system automatically pulls new data since the last sync, updates license assignment statuses, adds new billed cost entries, and appends new usage metrics — without user intervention.
4. **Given** Copilot syncing is enabled, **When** the admin clicks "Sync Now", **Then** the system immediately pulls the latest data and updates the last-synced timestamp.
5. **Given** a GitHub connection whose token lacks Copilot permissions, **When** the admin views the Copilot section, **Then** the system lists the missing scopes and provides instructions to update the token.
6. **Given** invalid or expired credentials, **When** a Copilot sync attempt is made, **Then** the system marks the sync as failed, displays a clear error, and notifies the admin that credentials need updating.
7. **Given** synced Copilot seat assignments, **When** the admin views the existing `/assignments` page, **Then** Copilot assignments appear alongside manually created assignments, clearly labeled as "managed by sync" and non-editable inline.

---

### User Story 2 - View Organization-Level Copilot Dashboard (Priority: P2)

As an administrator, I want to see an organization-level overview dashboard showing the overall health and adoption of GitHub Copilot across my organization, accessible from a dedicated "Copilot" section in the sidebar.

The Copilot section at `/copilot` uses a tab bar layout (matching the existing Reports page pattern) with four tabs: Overview, Seats, Billing, and Analytics. The Overview tab (default) presents Copilot-specific key metrics at a glance: total seats allocated vs. active, overall acceptance rate, total suggestions and acceptances over time, and adoption trends. The admin can select date ranges (including ranges beyond 100 days when historical data is available) and see aggregated metrics with trend lines. This dashboard focuses on Copilot-unique metrics (acceptance rates, suggestion volumes) that are not represented in the existing Reports page. Generic cost and license data are intentionally not duplicated here — the admin can navigate to the existing Reports and Budget pages where Copilot data already appears via the synced AI Tool and billed costs.

**Why this priority**: The organization overview is the primary landing page for understanding Copilot adoption and effectiveness — it provides immediate value once data is synced.

**Independent Test**: Can be fully tested by navigating to `/copilot` and verifying that organization-wide Copilot metrics, charts, and date range filtering render correctly with synced data.

**Acceptance Scenarios**:

1. **Given** synced Copilot data, **When** an admin navigates to the Copilot overview dashboard via the sidebar, **Then** they see summary cards showing total seats, active seats, overall acceptance rate, and total suggestions/acceptances.
2. **Given** the overview dashboard is displayed, **When** the admin selects a custom date range, **Then** all metrics and charts update to reflect only the selected period.
3. **Given** historical data spanning more than 100 days, **When** the admin selects a date range exceeding 100 days, **Then** the dashboard displays metrics from locally stored data covering the full requested range.
4. **Given** the overview dashboard, **When** the admin views trend charts, **Then** they see line/area charts showing daily or weekly usage trends (suggestions, acceptances, active users) over time, using the same chart component patterns as the existing Reports page.
5. **Given** the overview dashboard, **When** the admin wants to see cost or budget information, **Then** the dashboard provides navigation links to the existing Reports and Budget pages rather than duplicating that data.

---

### User Story 3 - View Seat Allocation and User Details (Priority: P3)

As an administrator, I want to see a detailed Copilot-specific view of all seat assignments enriched with seat-level activity data, so I can identify underutilized seats and optimize allocation.

The seat management view at `/copilot/seats` shows a searchable, sortable table of all users with Copilot seats, built on the same data table infrastructure as the existing assignments and users tables. Each row displays the user's name, GitHub username (linked from their GitHub profile), seat assignment date, last activity date, current status (active, inactive, pending), and Copilot plan type. The admin can filter by status, sort by any column, and identify users who have not used Copilot recently. Note: suggestion/acceptance counts are only available as organization-level aggregates (shown on the overview and analytics dashboards) — per-user data is limited to seat metadata and activity dates as provided by the GitHub API. Users are linked to their existing application profiles via the `githubProfiles` table, so clicking a user can navigate to either the Copilot seat detail or the existing user profile.

**Why this priority**: Seat-level visibility directly supports cost optimization by identifying unused or underutilized seats — a common pain point for organizations.

**Independent Test**: Can be fully tested by viewing the seat allocation table at `/copilot/seats`, searching/filtering users, and verifying user-level details match synced data.

**Acceptance Scenarios**:

1. **Given** synced seat assignment data, **When** an admin navigates to the Copilot seat allocation view, **Then** they see a data table listing all users with assigned Copilot seats, including seat-level columns (last activity date, status, plan type) not available on the general `/assignments` page.
2. **Given** the seat allocation table, **When** the admin searches for a specific user by name or GitHub username, **Then** the table filters to show matching results.
3. **Given** the seat allocation table, **When** the admin filters by status (e.g., "inactive"), **Then** only users matching that status are displayed.
4. **Given** the seat allocation table, **When** the admin sorts by "last activity", **Then** the table reorders to show least-recently-active users first (or vice versa), making it easy to spot underutilized seats.
5. **Given** a user row in the table, **When** the admin clicks on a user, **Then** a detail view at `/copilot/seats/[userId]` shows that user's seat history (assignment date, plan type, status changes, last activity timeline), with a link to their general user profile page.
6. **Given** a Copilot seat holder who also exists as an application user, **When** the admin views the existing `/users/[id]` page, **Then** the user's Copilot assignment is visible in their assignments list (synced via the license assignment model).

---

### User Story 4 - View Cost and Billing Dashboard (Priority: P4)

As an administrator, I want to see Copilot-specific cost analysis that combines synced billing data with usage metrics to evaluate ROI, complementing the existing budget and reports system.

The billing view at `/copilot/billing` shows Copilot-specific cost analysis: cost per active user, cost vs. acceptance rate, cost efficiency trends, and seat utilization vs. spend. This view draws from two sources: (a) Copilot billing snapshots stored locally from the API, and (b) billed cost entries already synced into the existing budget system. The admin can view billing data by month and see how costs correlate with actual Copilot usage to determine ROI. For general budget management (allocations, period planning, variance analysis), the admin navigates to the existing Budget pages where Copilot costs are already integrated.

**Why this priority**: Cost visibility is critical for budget justification but depends on both usage data (P2) and seat data (P3) being available for meaningful cost-per-user and ROI calculations.

**Independent Test**: Can be fully tested by navigating to `/copilot/billing` and verifying Copilot-specific cost figures, ROI visualizations, and cost-per-user calculations render correctly.

**Acceptance Scenarios**:

1. **Given** synced billing data, **When** an admin navigates to the Copilot billing view, **Then** they see the current month's Copilot cost, cumulative cost, and cost per active user.
2. **Given** the billing view, **When** the admin views the cost trend chart, **Then** they see monthly Copilot costs plotted over time.
3. **Given** usage and billing data, **When** the admin views the cost vs. utilization chart, **Then** they see a visualization comparing cost per seat against Copilot-specific usage metrics (acceptance rate, active days) to highlight ROI.
4. **Given** historical billing data beyond 100 days, **When** the admin selects an extended date range, **Then** the billing view displays cost data from locally stored records.
5. **Given** synced Copilot billing data, **When** the admin navigates to the existing Budget detail page, **Then** Copilot billed costs appear as line items within the relevant budget periods alongside other AI tool costs.
6. **Given** the existing Reports page Trends tab, **When** the admin views spend over time, **Then** Copilot costs are included in the aggregated spend trend without any Copilot-specific changes to the Reports page.

---

### User Story 5 - View Usage Patterns and Utilization Analytics (Priority: P5)

As an administrator, I want detailed analytics dashboards showing Copilot-specific usage patterns and utilization trends so I can understand how Copilot is being used across teams and over time.

The analytics view at `/copilot/analytics` provides breakdowns by language, editor, time period, and user activity levels. It shows which programming languages generate the most suggestions, which editors are most popular, peak usage times, and how utilization changes over time. This data can span beyond 100 days using locally persisted historical records. These breakdowns are unique to Copilot and have no equivalent in the existing Reports page (which focuses on cost/budget aggregations across all tools).

**Why this priority**: Deep analytics provide strategic insights but are additive to the core dashboards — they enhance decision-making rather than enable it.

**Independent Test**: Can be fully tested by viewing analytics charts at `/copilot/analytics` and verifying that breakdowns by language, editor, and time period render correctly with accurate data.

**Acceptance Scenarios**:

1. **Given** synced usage metrics, **When** an admin navigates to the usage analytics view, **Then** they see charts breaking down Copilot usage by programming language.
2. **Given** the analytics view, **When** the admin views the editor breakdown chart, **Then** they see which editors (VS Code, JetBrains, Neovim, etc.) are generating the most Copilot activity.
3. **Given** the analytics view with historical data, **When** the admin selects a 6-month date range, **Then** the system displays utilization trends using locally stored data beyond the API's 28-day limit.
4. **Given** the analytics view, **When** the admin views activity distribution, **Then** they see a visualization of user activity levels (e.g., power users vs. occasional users vs. inactive).

---

### User Story 6 - Historical Data Retention Beyond API Limits (Priority: P6)

As an administrator, I want the system to automatically retain Copilot analytics data beyond the GitHub API's 28-day metrics window so I can perform long-term trend analysis and year-over-year comparisons.

The system stores all synced data persistently and never discards historical records. This applies to both Copilot-specific metrics (stored in dedicated tables) and generic data that flows into existing models (license assignments retain their full history, billed costs persist across budget periods). The admin can view a data retention summary on the integrations settings page showing the earliest and latest data points available. When viewing any Copilot dashboard, the available date range extends back to the earliest synced record rather than being limited to the API's 100-day window.

**Why this priority**: Data retention is an infrastructure concern that operates in the background — its value is realized through the dashboards (P2-P5) when users select extended date ranges.

**Independent Test**: Can be fully tested by verifying that data synced more than 100 days ago remains available and accessible through any Copilot dashboard's date range selector.

**Acceptance Scenarios**:

1. **Given** data that was synced more than 100 days ago, **When** the admin views any Copilot dashboard with an extended date range, **Then** the historical data is available and displayed correctly.
2. **Given** the integrations settings page, **When** the admin views the Copilot data retention section, **Then** they see the date range of available data (earliest record to latest record) and total record counts.
3. **Given** a daily sync schedule running for 6 months, **When** the admin selects a 6-month date range on any Copilot dashboard, **Then** continuous data is displayed without gaps (except for any sync failures, which are indicated).

---

### Edge Cases

- What happens when the GitHub API rate limit is exceeded during a sync? The system pauses, respects rate limit headers, and resumes automatically — logging the delay. This follows the same rate-limit handling pattern already established in `src/lib/github.ts`.
- What happens when a sync fails partway through? The system records which data was successfully synced via the existing `githubSyncEvents` status tracking (partial status), and retries the remaining data on the next sync cycle.
- What happens when a user's Copilot seat is removed between syncs? The system revokes the corresponding license assignment (setting status to inactive with a revoked timestamp), preserving the historical usage data in the Copilot metrics tables. The user's record in `/assignments` updates to show the revoked assignment.
- What happens when the organization has no Copilot seats assigned? The Copilot dashboard displays an empty state with a clear message and guidance on how to assign seats in GitHub. The "GitHub Copilot" AI Tool entry still exists but shows zero active licenses.
- What happens when credentials are revoked or permissions change? The system detects the authorization failure (same pattern as existing GitHub sync), halts Copilot syncing, and notifies the admin with instructions to update credentials on the existing integrations settings page.
- How does the system handle organizations with thousands of Copilot users? Data sync uses the same pagination pattern established in `src/lib/github.ts` for member fetching, and dashboard queries use efficient aggregation to avoid loading all individual records.
- What happens during the very first sync when no historical data exists? The system shows a loading/syncing state and then displays whatever data the API provides (up to 28 days of rolling metrics history). The "GitHub Copilot" AI Tool and its tiers are auto-created during this initial sync.
- What happens when the Copilot AI Tool or its tiers are manually edited by an admin? Synced data takes precedence — the next sync overwrites manual changes to the tool name, vendor, and tier pricing. A warning is displayed if manual edits are detected on sync-managed entities.
- What happens when a Copilot seat holder does not have a matching application user? The seat is tracked in the Copilot-specific metrics tables with their GitHub identity. A license assignment is only created when a matching user exists via `githubProfiles`. The Copilot seat table shows unmatched users with a prompt to import them via the existing user import flow.
- What happens when Copilot plan type changes (e.g., Business to Enterprise)? The sync detects the tier change, updates the access tier on the license assignment (following the same upgrade/downgrade pattern as manual tier changes), and snapshots the new cost.
- What happens when a manual sync is triggered while a scheduled sync is already running? The system enforces mutual exclusion: the new request is rejected with a "Sync already in progress" message, and the "Sync Now" button is disabled while a sync is active. No concurrent sync operations are permitted.
- What happens when Copilot billing syncs but no active budget exists for the billing period? Billing snapshots are always stored in the Copilot billing table. Billed cost entries in the budget model are deferred until a budget covering that period is created, at which point they are backfilled automatically.
- What happens when the admin disables Copilot syncing? All synced data persists (AI Tool, license assignments, billed costs, usage metrics remain unchanged). Only scheduled syncing stops. The admin can re-enable syncing at any time, and the next sync picks up from where it left off. Copilot dashboards continue to display the existing historical data.

## Requirements *(mandatory)*

### Functional Requirements

**Connection & Sync (extends existing GitHub integration)**

- **FR-001**: System MUST allow admins to enable Copilot data syncing on an existing GitHub organization connection from the existing integrations settings page.
- **FR-002**: System MUST validate that the connected GitHub token has Copilot-related permission scopes and display missing scopes if insufficient.
- **FR-003**: System MUST perform an initial data sync upon enabling Copilot syncing, importing all available Copilot data from the GitHub API.
- **FR-004**: System MUST automatically sync new Copilot data on a configurable schedule (default: once daily).
- **FR-005**: System MUST allow admins to trigger a manual Copilot data sync at any time, provided no sync is currently in progress.
- **FR-005a**: System MUST enforce mutual exclusion on sync operations — if a sync (scheduled or manual) is already in progress, new sync requests are rejected with a "Sync already in progress" message. The "Sync Now" button MUST show a disabled state while a sync is active.
- **FR-006**: System MUST display Copilot sync status (last sync time, sync result, next scheduled sync) in the Copilot section of the existing integrations settings page.
- **FR-007**: System MUST track Copilot sync operations using the existing sync event model, distinguished by a sync type discriminator alongside existing member sync events.
- **FR-007a**: System MUST allow admins to disable Copilot syncing, which stops scheduled syncs while preserving all previously synced data (AI Tool, license assignments, billed costs, usage metrics). Re-enabling resumes syncing from the last sync point.

**Auto-Creation of AI Tool & License Assignments (bridges to existing models)**

- **FR-008**: System MUST auto-create a "GitHub Copilot" AI Tool entry (with vendor "GitHub") during the first Copilot sync if one does not already exist.
- **FR-009**: System MUST auto-create access tiers on the "GitHub Copilot" tool matching Copilot plan types (e.g., Business, Enterprise) with their corresponding monthly per-seat costs.
- **FR-010**: System MUST sync Copilot seat assignments as license assignments in the existing `licenseAssignments` model, linked to matched application users via GitHub profiles.
- **FR-011**: System MUST mark sync-managed license assignments with a source indicator distinguishing them from manually created assignments.
- **FR-012**: System MUST prevent inline editing of sync-managed license assignments in the UI, displaying them as read-only with a clear "managed by sync" label.
- **FR-013**: System MUST update the `maxLicenses` field on the "GitHub Copilot" AI Tool to reflect the organization's total seat allocation from the API.
- **FR-014**: System MUST revoke license assignments (set inactive with revoked timestamp) when Copilot seats are removed in GitHub, preserving historical data.
- **FR-015**: System MUST handle Copilot tier changes (e.g., Business to Enterprise) by updating the access tier on affected license assignments following the existing upgrade/downgrade pattern.

**Billing Integration (bridges to existing budget model)**

- **FR-016**: System MUST import Copilot billing data and create billed cost entries in the existing `billedCosts` model, linked to the appropriate budget periods based on billing dates — but only when a matching budget period exists. If no active budget covers the billing date, the billed cost entry is deferred.
- **FR-016a**: System MUST backfill deferred billed cost entries when a budget is later created that covers previously synced Copilot billing periods.
- **FR-017**: System MUST always store Copilot billing snapshots locally (in the dedicated Copilot billing table) regardless of whether a matching budget period exists, ensuring no billing data is lost.
- **FR-018**: System MUST tag synced billed cost entries with a vendor reference identifying them as Copilot billing data to prevent duplication on re-sync.

**Copilot-Specific Metrics Storage (new, isolated data)**

- **FR-019**: System MUST import and store Copilot usage metrics including suggestion count, acceptance count, lines suggested, lines accepted, and active user count, broken down by language and editor where available.
- **FR-020**: System MUST persistently store all synced Copilot data and never discard historical records, enabling long-term trend analysis beyond the API's 28-day limit.
- **FR-021**: System MUST display data retention information (date range of available Copilot data, record counts) in the Copilot section of the integrations settings page.

**Copilot Overview Dashboard (new pages under /copilot)**

- **FR-022**: System MUST provide a Copilot overview dashboard at `/copilot` with summary cards (total seats, active seats, acceptance rate, total suggestions/acceptances).
- **FR-023**: System MUST provide trend charts on the Copilot overview dashboard showing Copilot-specific usage metrics over time.
- **FR-024**: System MUST support date range selection on all Copilot dashboards, including ranges extending beyond the API's 28-day data limit.
- **FR-025**: System MUST provide navigation links from the Copilot overview to the existing Reports and Budget pages for cost-related analysis.

**Copilot Seat Allocation View (new pages, reuses data table patterns)**

- **FR-026**: System MUST provide a seat allocation view at `/copilot/seats` with a searchable, sortable, filterable table of all Copilot seat holders, including seat-level columns (last activity date, status, plan type, days since last active).
- **FR-027**: System MUST provide a user detail view at `/copilot/seats/[userId]` showing an individual user's seat history (assignment date, plan type, status changes, last activity timeline), with a link to their general user profile. Note: per-user suggestion/acceptance metrics are not available from the API — org-level aggregates are shown on the overview and analytics dashboards instead.
- **FR-028**: System MUST display unmatched Copilot seat holders (users without a corresponding application account) in the seat table with a prompt to import them via the existing user import flow.

**Copilot Billing View (new page, complements existing budget)**

- **FR-029**: System MUST provide a Copilot billing view at `/copilot/billing` showing Copilot-specific cost analysis: cost per active user, cost vs. utilization (acceptance rate), and cost efficiency trends.
- **FR-030**: System MUST NOT duplicate general budget management features (period allocations, variance analysis) — these remain on the existing Budget pages where Copilot costs already appear.

**Copilot Analytics View (new page, unique data)**

- **FR-031**: System MUST provide analytics breakdowns at `/copilot/analytics` by programming language, editor, and time period.
- **FR-032**: System MUST provide user activity distribution analysis (power users vs. occasional users vs. inactive) on the analytics view.

**Error Handling & Resilience**

- **FR-033**: System MUST handle API rate limits gracefully by pausing and resuming sync operations, following the same rate-limit pattern as the existing GitHub API wrapper.
- **FR-034**: System MUST handle partial sync failures by tracking progress via the sync event model and retrying on the next cycle.
- **FR-035**: System MUST display appropriate empty states when no Copilot data is available (syncing not enabled, no seats assigned, pending initial sync).
- **FR-036**: System MUST notify admins when Copilot-related credentials become invalid or permissions are insufficient, using the same notification pattern as existing GitHub connection errors.

**Navigation**

- **FR-037**: System MUST add a single "Copilot" navigation item in the sidebar (admin-only) as a peer to existing items (Tools, Users, Reports, etc.), leading to `/copilot`.
- **FR-038**: System MUST provide a tab bar within the `/copilot` layout for navigating between Overview, Seats, Billing, and Analytics views, matching the existing Reports page tab bar pattern. The user detail view (`/copilot/seats/[userId]`) is accessed from within the Seats tab and provides a back link to the Seats tab.

### Key Entities

- **GitHub Organization Connection** *(existing — reused)*: The existing `githubConnections` record is reused as-is. Copilot syncing is an additional capability on the same connection, controlled by a Copilot-enabled flag and scope validation. No separate connection entity is needed.

- **GitHub Profile** *(existing — reused)*: The existing `githubProfiles` table provides the identity bridge between Copilot seat holders and application users. Copilot seat syncing uses this mapping to create license assignments for matched users.

- **AI Tool: GitHub Copilot** *(existing model — auto-created instance)*: A record in the existing `aiTools` table, auto-created during the first Copilot sync with name "GitHub Copilot", vendor "GitHub", and `maxLicenses` set to the organization's seat allocation. Managed by sync — manual edits are overwritten.

- **Access Tiers: Copilot Plans** *(existing model — auto-created instances)*: Records in the existing `accessTiers` table representing Copilot plan types (e.g., Business at $19/month, Enterprise at $39/month). Pricing auto-updated from API data on each sync.

- **License Assignment: Copilot Seats** *(existing model — sync-managed instances)*: Records in the existing `licenseAssignments` table, one per Copilot seat holder matched to an application user. Distinguished by a source indicator marking them as sync-managed (read-only). Includes workspace (org login), tier (Copilot plan), and cost snapshot.

- **Sync Event** *(existing — extended)*: The existing `githubSyncEvents` table extended with a sync type field to distinguish Copilot sync operations (seats, metrics, billing) from member syncs. Tracks status (in_progress/completed/partial/failed), counts, errors, and timing.

- **Copilot Usage Metric** *(new)*: A time-series record of Copilot-specific usage data — includes date, suggestion count, acceptance count, lines suggested, lines accepted, active user count, breakdowns by programming language and editor, and link to the GitHub connection. This data has no equivalent in the existing schema and is only rendered on Copilot-specific pages.

- **Copilot Billing Snapshot** *(new)*: A periodic (monthly) record of Copilot billing data from the API — includes billing period, total cost, seat count, and cost per seat. Serves as the source of truth for historical billing retention. On each sync, a corresponding `billedCosts` entry is also created/updated in the existing budget system for integration with budget tracking.

### Assumptions

- The existing GitHub organization connection and authentication infrastructure is reused; Copilot syncing is an add-on capability, not a separate integration.
- The existing `githubProfiles` table provides sufficient identity mapping between Copilot seat holders and application users; no additional identity resolution is needed beyond GitHub username/ID matching.
- A single GitHub organization connection is supported; Copilot data is scoped to that organization.
- The "GitHub Copilot" AI Tool entry and its tiers are fully managed by the sync process; manual edits are overwritten on the next sync to maintain data consistency.
- Sync-managed license assignments are read-only in the application UI but visible in all existing views (assignments list, user detail, reports) alongside manually created assignments.
- Copilot billing data granularity depends on what the GitHub API provides; the system stores whatever level of detail is available and creates `billedCosts` entries at the monthly level.
- Usage metric breakdowns (by language, editor) are stored as provided by the GitHub API and may vary over time as GitHub updates their API response format.
- The existing admin role is sufficient for Copilot dashboard access; no new roles or permissions are introduced.
- Copilot-specific pages (`/copilot/*`) use the same layout, sidebar, and component patterns as existing pages — no custom layout or separate design system.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Admins can enable Copilot syncing on an existing GitHub connection and complete an initial data sync within 5 minutes of setup.
- **SC-002**: After initial sync, the existing main dashboard KPIs (Active Tools, Active Licenses, Monthly Spend) automatically reflect Copilot data without any manual configuration.
- **SC-003**: Copilot license assignments appear in the existing `/assignments` page, existing `/tools` detail page, and existing Reports aggregations without modifications to those features.
- **SC-004**: Copilot billed costs appear in the existing Budget detail page and contribute to existing spend trends and forecast calculations without modifications to the Budget feature.
- **SC-005**: All Copilot-specific dashboards (`/copilot`, `/copilot/seats`, `/copilot/billing`, `/copilot/analytics`) load and render within 3 seconds for organizations with up to 5,000 Copilot users.
- **SC-006**: Historical data is available for date ranges exceeding 100 days, with no data loss across consecutive sync cycles.
- **SC-007**: Admins can identify underutilized Copilot seats (inactive for 30+ days) within 30 seconds using the seat allocation view.
- **SC-008**: Cost-per-active-user and ROI metrics are accurately calculated and displayed on the Copilot billing view, enabling admins to make informed budget decisions.
- **SC-009**: Automated daily syncs run reliably with a success rate of 99%+ over any 30-day period.
- **SC-010**: Admins can view Copilot usage trends spanning 6+ months when sufficient historical data has been collected, enabling long-term pattern analysis.
- **SC-011**: No existing feature (assignments, tools, budget, reports, users, invoices) requires code changes to display Copilot data — integration happens purely through shared data models.
