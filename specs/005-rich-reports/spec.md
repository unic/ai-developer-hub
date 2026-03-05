# Feature Specification: Rich Visual Reports

**Feature Branch**: `005-rich-reports`
**Created**: 2026-03-05
**Status**: Draft
**Input**: User description: "I want to add richer and more visual reports. To not overload the current reports page, consider adding a subnavigation or tabs or any other concept that seems reasonable. The goal is to see at a glance the current trends, the current usage, and potentially forecasts about the budget situation."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - At-a-Glance Overview (Priority: P1)

A manager opens the Reports section and immediately sees an Overview dashboard with summary cards: total spend this period, budget remaining, active license count, and sparkline trend indicators showing whether spend is going up or down. No need to click further — the most critical information is visible at once.

**Why this priority**: The primary stated goal is "at a glance" visibility. Without this, none of the other views deliver value on their own to a time-pressured manager.

**Independent Test**: Can be fully tested by navigating to Reports and verifying summary cards display correct aggregated values and trend direction indicators, delivering an immediately actionable budget health snapshot.

**Acceptance Scenarios**:

1. **Given** a user is on the Reports page, **When** the page loads, **Then** they see summary cards for total budget, amount spent, amount remaining, and a percentage utilization indicator — all without any additional clicks.
2. **Given** spending is trending upward, **When** the user views the Overview, **Then** an upward trend indicator is visible alongside the spend card.
3. **Given** there is no spending data yet, **When** the user views the Overview, **Then** empty-state messaging explains that data will appear once tool assignments are recorded.

---

### User Story 2 - Navigating Between Report Views (Priority: P1)

A user sees a tab bar (or sub-navigation) at the top of the Reports section with labels such as Overview, Trends, Usage, and Forecast. They click "Trends" and the content area updates to show a time-series chart — no full page reload occurs.

**Why this priority**: The navigation structure is the foundation that makes all other report views accessible without overloading a single page.

**Independent Test**: Can be fully tested by clicking each tab and verifying the correct content section appears, including correct URL state or query parameter reflection so sharing or refreshing the page returns to the same tab.

**Acceptance Scenarios**:

1. **Given** the user is on the Reports page, **When** they click any tab in the sub-navigation, **Then** the content area updates without a full page reload and the selected tab is visually highlighted.
2. **Given** the user is on the Trends tab, **When** they refresh the page, **Then** the Trends tab remains active.
3. **Given** the user navigates away and returns to Reports, **When** the page loads, **Then** the default tab (Overview) is displayed.

---

### User Story 3 - Trends Over Time (Priority: P2)

A team lead navigates to the Trends tab and sees a line chart or bar chart showing spending and/or license usage over time. They can select a time range (e.g., last 30 days, last 3 months, last 6 months) to zoom in or out, helping them spot seasonal patterns or unexpected spikes. Data points are automatically grouped by day (≤30 days), week (≤90 days), or month (longer ranges) to keep the chart readable.

**Why this priority**: Trends give context to the current snapshot. Without historical perspective, the overview numbers are hard to evaluate.

**Independent Test**: Can be fully tested by viewing the Trends tab with at least two months of seeded data and verifying charts render correctly with period-selector controls and auto-scaled granularity.

**Acceptance Scenarios**:

1. **Given** historical spending data exists, **When** the user opens the Trends tab, **Then** a chart displays spending over time with clearly labeled axes and a legend.
2. **Given** the user selects "Last 3 months" from the time range selector, **When** the selection is applied, **Then** the chart updates to show only data within that period, aggregated by week.
3. **Given** fewer than 2 data points exist for the selected period, **When** the user views the chart, **Then** a message indicates insufficient data for a meaningful trend line while showing the available points.

---

### User Story 4 - Current Usage Breakdown (Priority: P2)

A license administrator navigates to the Usage tab and sees a breakdown of license utilization per tool or category — how many licenses are assigned vs. available, and which tools account for the largest share of spend. They can identify underutilized or over-allocated tools quickly.

**Why this priority**: Usage visibility helps administrators make data-driven reallocation decisions, a core operational need.

**Independent Test**: Can be fully tested by navigating to the Usage tab with active license assignments and verifying per-tool utilization data renders as charts and/or a data table.

**Acceptance Scenarios**:

1. **Given** licenses are assigned, **When** the user opens the Usage tab, **Then** they see each tool with its assigned count, total available count, and utilization percentage.
2. **Given** a tool has 0 assignments, **When** it appears in the Usage view, **Then** it is visually distinguished (e.g., shown as 0% utilized) to highlight underutilization.
3. **Given** the user wants a different view, **When** they toggle between chart view and table view, **Then** the same data is presented in the selected format.

---

### User Story 5 - Budget Forecast (Priority: P3)

A budget owner navigates to the Forecast tab and sees a projection of expected spending for the next 3–6 months based on current usage patterns. The projection is presented as a chart with a confidence band, and a summary states whether the team is on track to stay within their annual budget.

**Why this priority**: Forecasting is the highest-value but most data-dependent view. It requires sufficient historical data to be meaningful, making it secondary to the foundational views above.

**Independent Test**: Can be fully tested with at least 3 months of seeded historical data by verifying a projected spend line extends beyond the current date and a "within budget" or "over budget" status message is shown.

**Acceptance Scenarios**:

1. **Given** at least 3 months of spending history exists, **When** the user opens the Forecast tab, **Then** a chart shows historical spend plus a projected spend line for the next 3–6 months.
2. **Given** the projected spending would exceed the annual budget, **When** the user views the Forecast tab, **Then** a prominent warning message is displayed indicating the projected overrun amount.
3. **Given** insufficient data for a reliable forecast (less than 3 months), **When** the user opens the Forecast tab, **Then** an informational message explains that more usage data is needed and shows the current month-to-date spend instead.

---

### Edge Cases

- What happens when there is no spending or usage data at all (brand-new system)?
- How does the system handle mid-period budget changes that affect trend continuity?
- What if a tool is removed but historical data still references it — is it shown in Trends/Usage with a "deleted" label?
- How does the forecast behave when the budget period is annual but data only spans a few months?
- What if a user bookmarks a specific tab URL and that tab is later renamed or removed?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Reports section MUST present content through a tabbed sub-navigation with at minimum four sections: Overview, Trends, Usage, and Forecast.
- **FR-002**: The Overview tab MUST display summary cards showing: total budget for the current period, total amount spent, remaining budget, and active license count — all visible without scrolling on a standard desktop screen.
- **FR-003**: The Overview tab MUST include at-a-glance trend indicators (e.g., sparklines or directional arrows) on spend-related cards showing whether values are increasing or decreasing compared to the prior period.
- **FR-004**: The Trends tab MUST display a time-series chart of spending and/or usage with a time range selector offering at least: Last 30 days, Last 3 months, Last 6 months, and Last 12 months.
- **FR-005**: The Usage tab MUST display per-tool license utilization showing assigned count, total available, and utilization percentage, with both a visual (chart) and tabular representation accessible via a toggle. By default the top 10 tools sorted by utilization/spend MUST be shown; a "show all" option or paginated view MUST be available when more than 10 tools exist.
- **FR-006**: The Forecast tab MUST project future monthly spending for a minimum of 3 months ahead using a linear trend derived from all available historical data (up to 12 months), and MUST display a clear status indicating whether the team is projected to stay within or exceed their budget.
- **FR-007**: The Forecast tab MUST show a clear empty/insufficient-data state when less than 3 months of spending history is available, and MUST still display current month-to-date spend in that state.
- **FR-008**: All chart views MUST include labeled axes, a legend where multiple data series are shown, and MUST automatically scale data aggregation granularity: daily for time ranges of 30 days or fewer, weekly for 31–90 days, and monthly for ranges exceeding 90 days.
- **FR-009**: The selected tab MUST be reflected in the URL (e.g., via a query parameter or path segment) so that the view is bookmarkable and shareable.
- **FR-010**: All report sections MUST display an appropriate empty-state message when no relevant data is available, guiding the user on how to generate data.
- **FR-011**: While a tab's data is loading, the system MUST display skeleton screens — placeholder shapes that match the final layout — rather than spinners or blank areas, to minimise perceived wait time and prevent layout shift.

### Key Entities

- **Budget Period**: A defined time window (monthly/annual) with a total budget amount, scoped to the organization or a team.
- **Spend Record**: An individual cost entry for a tool license or subscription, aggregated by period for charting and forecasting.
- **License Utilization**: Per-tool summary of total license seats, assigned seats, and active-user count within a reporting period.
- **Forecast Point**: A projected spend value for a future month, derived from a linear trend calculation over historical spend records.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can identify the current budget health status (total spend, remaining budget, trend direction) within 10 seconds of arriving on the Reports page, without any additional clicks.
- **SC-002**: Users can switch between all report tabs without a full page reload, with each tab's content appearing within 2 seconds of clicking.
- **SC-003**: Users can view spending trends over at least four selectable time ranges and see the chart update immediately upon selecting a range, with data automatically grouped at the appropriate granularity (daily / weekly / monthly).
- **SC-004**: Users can identify the top 3 highest-spend or most-utilized tools from the Usage tab without scrolling or applying filters; up to 10 tools are shown by default with a "show all" option available for larger catalogues.
- **SC-005**: Users can see a forward-looking budget projection of at least 3 months, including a clear "on track" or "at risk" status, when sufficient historical data exists.
- **SC-006**: All report sections display their data within 3 seconds of the tab becoming active, including full chart rendering.
- **SC-007**: Empty and insufficient-data states are shown for every report section when applicable, ensuring users are never presented with blank or broken views.

## Assumptions

- The existing Reports page has at least one active view that will be reorganized under the Overview tab rather than replaced entirely.
- Budget periods and spending records are already stored in the system from prior features (001-ai-tool-budget-tracker, 003-enhance-core-features).
- License assignment data from 004-bulk-license-import is available to populate the Usage tab.
- Forecast projections use a simple linear regression over all available history (up to 12 months) — no complex statistical modeling is required for this feature.
- All four report tabs are visible to all authenticated users; no role-based tab or data restrictions are introduced by this feature.
- The primary target viewport is desktop (1280px and wider); mobile layout is a nice-to-have but not a blocking requirement.

## Clarifications

### Session 2026-03-05

- Q: How should Trends chart data be aggregated based on the selected time range? → A: Auto-scale — daily for ≤30 days, weekly for ≤90 days, monthly for longer ranges.
- Q: How many months of historical data should the forecast baseline use? → A: All available history up to 12 months (linear regression input).
- Q: Should any report tabs or budget figures be restricted by user role? → A: No — all four tabs and all data are visible to all authenticated users.
- Q: How should the Usage tab handle large numbers of tools? → A: Show top 10 by default (sorted by utilization/spend), with a "show all" or paginated view for catalogues exceeding 10 tools.
- Q: What loading state pattern should tabs use while data fetches? → A: Skeleton screens matching the final layout (no spinners, no blank areas).
