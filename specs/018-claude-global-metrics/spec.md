# Feature Specification: Global Claude Console Metrics & Budget Monitoring

**Feature Branch**: `018-claude-global-metrics`
**Created**: 2026-03-20
**Status**: Draft
**Input**: User description: "There are already claude console cost data on a user level. the application should be extended to also show global data and metrics for claude console. I want to see overall costs and filterable by workspace and api keys. Also, i want a possibility to track workspace cost limits and consumption to have an early indication when budget limits are running low. additionally, i want to see and have warning about total budget limits and available credits. The goal is to act proactively and now have users blocked by overrun limits or missing credits."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Org-Wide Claude Cost Dashboard (Priority: P1)

An administrator wants to see the total Claude API costs for the entire organization in one place, not just per user. They can view overall cost totals with a daily breakdown and filter by workspace or API key to understand where spending is coming from.

**Why this priority**: This is the foundational view all other stories depend on. Without an org-level cost dashboard, administrators cannot identify spending patterns, attribute costs, or take action before problems occur.

**Independent Test**: Can be fully tested by navigating to the global Claude metrics page and verifying that costs across all users are aggregated and displayed, delivering a complete org-level spend overview.

**Acceptance Scenarios**:

1. **Given** I am logged in as an administrator, **When** I navigate to the global Claude metrics page, **Then** I see the total organization cost for the current month and a daily cost breakdown chart covering all users and workspaces.
2. **Given** I am on the global metrics page, **When** I select a workspace from the filter, **Then** the cost totals and breakdown chart update to show only costs attributed to that workspace.
3. **Given** I am on the global metrics page, **When** I select a specific API key from the filter, **Then** costs are scoped to that API key only.
4. **Given** I am a non-administrator user, **When** I attempt to access the global metrics page, **Then** I am denied access and redirected.

---

### User Story 2 - Workspace Budget Limit Tracking & Early Warning (Priority: P2)

An administrator wants to define monthly spending limits for individual workspaces and see at a glance how close each workspace is to reaching its limit. When consumption reaches a warning threshold, the workspace is visually highlighted so the admin can act before anyone is blocked.

**Why this priority**: This is the core proactive monitoring capability. Without configurable limits and consumption indicators, administrators cannot prevent users from hitting spending caps that disrupt access.

**Independent Test**: Can be fully tested by setting a monthly limit on a workspace, then verifying the consumption percentage indicator and warning state are shown correctly without needing any other story implemented.

**Acceptance Scenarios**:

1. **Given** I am an administrator on the workspace budget view, **When** I set a monthly spending limit for a workspace, **Then** the limit is saved and the workspace displays a current consumption percentage.
2. **Given** a workspace has consumed 80% or more of its configured monthly limit, **When** I view the workspace budget overview, **Then** that workspace is visually flagged with a warning indicator.
3. **Given** a workspace has exceeded 100% of its configured monthly limit, **When** I view the workspace budget overview, **Then** a critical alert is prominently shown for that workspace.
4. **Given** a workspace has no limit configured, **When** I view the workspace budget overview, **Then** its current spend is shown without any limit or consumption indicator.
5. **Given** I need to remove a workspace limit, **When** I clear the limit value and save, **Then** the workspace returns to unlimited state with no consumption indicator.

---

### User Story 3 - Organization Credit Balance & Budget Warning (Priority: P3)

An administrator wants to see the organization's total available Anthropic credits and billing budget limit on the global dashboard. When credits are running low or the budget cap is nearly reached, a visible warning is shown—ideally early enough to top up before any disruption occurs.

**Why this priority**: Prevents the most severe scenario (complete org-level service disruption due to exhausted credits), but depends on data exposed by the external API. Builds on the global dashboard established in P1.

**Independent Test**: Can be tested independently by verifying the credit balance and budget panel appears on the global metrics page with the correct warning states for low-credit scenarios.

**Acceptance Scenarios**:

1. **Given** I am an administrator on the global metrics page, **When** the page loads, **Then** I see the organization's current available credit balance and configured billing budget limit.
2. **Given** available credits are below a warning threshold (less than 20% remaining), **When** I view the global metrics page, **Then** a prominent warning banner is displayed.
3. **Given** available credits are critically low (less than 5% remaining), **When** I view the global metrics page, **Then** a critical alert is displayed at the top of the page.
4. **Given** credit or budget data is unavailable or could not be fetched from the external source, **When** I view the global metrics page, **Then** an informative "data unavailable" indicator is shown in place of the credit panel.

---

### User Story 4 - Historical Global Cost Reporting (Priority: P4)

An administrator wants to view org-wide costs for previous months to identify trends and compare month-over-month spending across workspaces.

**Why this priority**: Historical analysis supports budget planning but is secondary to real-time monitoring. It extends the dashboard without requiring new data stores.

**Independent Test**: Can be tested by selecting a previous month on the global metrics page and verifying the org totals and workspace breakdown reflect that period correctly.

**Acceptance Scenarios**:

1. **Given** I am on the global metrics page, **When** I select a previous month from the month picker, **Then** total costs and workspace breakdowns for that month are displayed.
2. **Given** I have filtered by a workspace, **When** I change the selected month, **Then** the workspace filter persists and historical data for that workspace is shown.
3. **Given** a workspace had zero activity in a selected month, **When** I filter by that workspace, **Then** zero costs are shown without any error or warning state.

---

### Edge Cases

- What happens when a workspace has no costs in the selected month? → Show zero cost with no warning or budget consumption.
- What happens when the Anthropic API does not return credit balance data? → Show an "unavailable" indicator without hiding other dashboard content.
- What happens when a budget limit is set to zero or a negative number? → Validation rejects the input and shows an error before saving.
- What happens when cost data is currently being synced? → Show last known data with a "syncing" status indicator; do not block the page.
- What happens when a workspace has exceeded its limit and the admin has not yet acted? → Critical alert remains visible until consumption drops below the threshold.
- What happens when there are many workspaces? → The workspace list is scrollable; filtering remains instant.
- What happens when an admin is not actively viewing the global metrics page when a threshold is breached? → An in-app notification badge persists in the navigation until the admin acknowledges or the condition resolves.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a global Claude API cost overview page accessible exclusively to administrators.
- **FR-002**: Global cost view MUST display total organization spending for the selected month with a daily cost breakdown chart aggregated across all workspaces and API keys.
- **FR-003**: Global cost view MUST allow filtering by workspace, updating all cost figures and charts to reflect that workspace only.
- **FR-004**: Global cost view MUST allow filtering by API key, updating all cost figures to reflect that specific key only.
- **FR-005**: Global cost view MUST support month selection to browse historical org-wide cost data. When viewing historical months, workspace consumption percentages are always calculated against the currently configured limit (no limit history is maintained).
- **FR-006**: Administrators MUST be able to set a monthly spending limit for any workspace.
- **FR-007**: System MUST display each workspace's current monthly spending as a percentage of its configured limit, visually represented as a progress indicator. The current month's spend figure MUST be sourced from Anthropic API billing period data, resetting each calendar month in line with Anthropic's billing cycle.
- **FR-008**: System MUST apply a warning state (visually distinct) to any workspace that has consumed 80% or more of its configured monthly limit.
- **FR-009**: System MUST apply a critical alert state to any workspace that has exceeded 100% of its configured monthly limit.
- **FR-010**: Administrators MUST be able to remove a workspace spending limit, returning it to an unlimited state.
- **FR-011**: Global metrics page MUST display the organization's current available Anthropic credit balance when data is accessible.
- **FR-012**: Administrators MUST be able to manually configure the organization's billing budget limit within the application. The global metrics page MUST display this configured value alongside current org spend.
- **FR-013**: System MUST display a warning indicator when available credits fall below 20% of the total credit balance.
- **FR-014**: System MUST display a critical alert when available credits fall below 5% of the total credit balance.
- **FR-015**: Credit and budget balance data MUST be refreshed on each regular sync cycle without requiring manual action. The sync MUST run on an automated hourly schedule via a dedicated cron job.
- **FR-016**: System MUST gracefully handle unavailable credit or budget data by showing an informative placeholder rather than an error or blank space.
- **FR-017**: System MUST display a persistent in-app notification badge visible from any page in the admin interface when any monitored threshold is actively breached (workspace at ≥80% of limit, or org credits below 20%).
- **FR-018**: In-app notification badge MUST remain visible until the threshold condition resolves or the administrator explicitly dismisses it.
- **FR-019**: System MUST display the org billing budget limit as a progress indicator comparing current month's total org spend against the manually configured budget limit, with the same warning (≥80%) and critical (≥100%) threshold states applied.

### Key Entities

- **Workspace**: A named organizational unit within the Anthropic Console that groups one or more API keys and accumulates usage costs. Workspaces are retrieved from the Anthropic Admin API (not defined locally). Has an optional administrator-defined monthly spending limit stored within the application.
- **Workspace Budget Limit**: A monthly cost cap defined by an administrator for a specific workspace. Consumption is measured against the current calendar month's spend as reported by the Anthropic API for that workspace's billing period. Resets automatically each calendar month in line with Anthropic's billing cycle. Drives the consumption percentage display and triggers warning or critical alert states at configurable thresholds.
- **Organization Credit Balance**: The current remaining prepaid or allocated credits available to the entire organization as reported by Anthropic. Used to warn admins before credits run out.
- **Organization Budget Limit**: The total monthly spending cap manually configured by an administrator within the application. Stored locally (not synced from Anthropic). Shown alongside current org spend as a progress indicator with warning and critical threshold states. Expected to be stable and infrequently updated.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Administrators can view complete org-wide Claude cost data for the current month within 3 seconds of navigating to the global metrics page.
- **SC-002**: Filtering by workspace or API key refreshes all displayed data within 1 second without a full page reload.
- **SC-003**: Every workspace that reaches 80% of its configured limit triggers an in-app notification badge visible to administrators from any page, before the limit is exceeded.
- **SC-004**: Every instance of critically low credit balance (below 5%) triggers both a visible critical alert on the global metrics page and an in-app notification badge, before credits are fully exhausted.
- **SC-005**: Administrators can create or update a workspace spending limit in under 30 seconds.
- **SC-006**: All global metrics data (workspace costs, credit balance, budget limits) is no older than one hour, driven by an automated hourly cron job.
- **SC-007**: Zero instances of users being blocked by budget overruns or exhausted credits that were not preceded by at least one visible administrator warning.

## Assumptions

- Workspaces are named organizational units in the Anthropic Console, each with a unique identifier and name retrievable from the Anthropic Admin API. API keys belong to workspaces. Cost data can therefore be grouped at the workspace level by aggregating across the API keys that belong to it.
- The org billing budget limit is manually entered by an administrator and stored in the application. It is expected to be stable and changed infrequently. The Anthropic API does not expose this value programmatically.
- All global metrics views and workspace budget management are restricted to administrators; regular users continue to see only their own cost data on their profile page.
- Warning thresholds (80% for warning, 100% for critical on workspace limits; 20% for warning, 5% for critical on org credits) are sensible defaults and are not user-configurable in this feature.
- Workspace budget limits are stored within the application rather than written back to Anthropic, since Anthropic may not expose budget configuration via API.
- Global metrics data (workspace costs, credit balance, budget limits) MUST be refreshed by a dedicated cron job running hourly. This may extend the existing per-user sync cron job or run as a separate scheduled job.
- This feature adds a new global metrics layer on top of the existing per-user cost data; it does not modify how individual user costs are stored or displayed.

## Clarifications

### Session 2026-03-20

- Q: When a threshold is breached (workspace at 80%+, credits below 20%), how should administrators be notified? → A: In-app notifications — a persistent badge/alert visible from anywhere in the admin interface when a threshold is actively breached.
- Q: What does "workspace" mean in this feature — Anthropic Console Workspaces, individual API keys, or admin-defined groups? → A: Anthropic Console Workspaces — named organizational units from the Anthropic Admin API that group API keys; cost data aggregated per workspace.
- Q: When does a workspace's monthly spending limit reset? → A: Calendar month, automatically aligned with Anthropic's billing cycle — current period spend is sourced directly from the Anthropic API rather than calculated independently.
- Q: If the Anthropic API does not expose credit balance or budget limit data, should there be a manual admin fallback? → A: Revised — org billing budget limit supports manual admin entry (stable value, rarely changes). Org credit balance remains "unavailable" (changes continuously, manual entry not meaningful).
- Q: When viewing a historical month, which budget limit should workspace consumption be calculated against? → A: Always the current configured limit — no limit history is maintained.
