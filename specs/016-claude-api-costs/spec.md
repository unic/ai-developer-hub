# Feature Specification: Claude API Cost Tracking

**Feature Branch**: `016-claude-api-costs`
**Created**: 2026-03-16
**Status**: Draft
**Input**: User description: "The users with Claude Console access via API key are able to see the costs of the current month and their daily token costs grouped by model. The goal is to enable the users to track their own costs."

## Clarifications

### Session 2026-03-16

- Q: Does accessing the profile page require re-entering password or just standard session auth? → A: Standard session authentication — logged-in users can view their own profile without re-entering their password.
- Q: Should the profile page also show the user's assigned AI tools/licenses? → A: Yes — show assigned tools/licenses alongside Claude API costs for a complete self-service view.
- Q: Should admins be able to see a user's Claude API costs on the admin user detail page? → A: Yes — admins can see a user's Claude API costs on the admin user detail page.
- Q: How should users navigate to their profile page? → A: User avatar/menu dropdown in the header with a "My Profile" link.
- Q: Do users manage their own API keys? → A: No — API key storage and updates are handled by admins using existing functionality. Users only view their cost data.
- Q: Are daily token costs and visual chart separate views? → A: No — they are combined into a single unified view with chart and supporting data together.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Access Personal Profile Page (Priority: P1)

As an authenticated user, I want to access my own profile page so that I can view my personal information, assigned AI tools/licenses, and Claude API cost tracking data in one place. The profile page is read-only (no editing of personal details) and only accessible to the user themselves via standard session authentication.

**Why this priority**: The profile page is the container for all self-service features including cost tracking and tool assignments. Without it, there is no place for users to view their own data.

**Independent Test**: Can be fully tested by logging in as any user and navigating to the profile page, verifying it shows the user's own information, assigned tools, and cost data in read-only mode.

**Acceptance Scenarios**:

1. **Given** a user is logged in, **When** they navigate to their profile page, **Then** they see their own personal information (name, email, role) in read-only format.
2. **Given** a user has assigned AI tools/licenses, **When** they view their profile page, **Then** they see a list of their currently assigned tools with relevant details (tool name, tier, assignment date).
3. **Given** a user is logged in, **When** they attempt to access another user's profile, **Then** the system denies access and redirects them to their own profile.
4. **Given** a user is not logged in, **When** they attempt to access the profile page, **Then** they are redirected to the login page.

---

### User Story 2 - View Current Month's Total Cost (Priority: P1)

As a user with a Claude Console API key configured in the system, I want to see the total cost incurred for the current billing month on my profile page so that I can monitor my spending at a glance.

**Why this priority**: Knowing the current month's total spend is the most fundamental cost tracking need. Without this, users have no visibility into their API consumption.

**Independent Test**: Can be fully tested by navigating to the profile page and verifying the current month's total cost is displayed, delivering immediate spending visibility.

**Acceptance Scenarios**:

1. **Given** a user has a valid Claude Console API key stored in the system, **When** they navigate to their profile page, **Then** they see the total cost for the current calendar month displayed in US dollars.
2. **Given** a user has no API usage for the current month, **When** they view the cost tracking section on their profile, **Then** they see a total of $0.00 with a clear indication that no usage has been recorded.
3. **Given** a user's API key has not been configured or is invalid, **When** they view the cost tracking section, **Then** they see an informative message explaining that no API key is configured and to contact their administrator.

---

### User Story 3 - View Daily Token Costs with Visual Chart (Priority: P1)

As a user tracking my Claude API costs, I want to see a day-by-day breakdown of token costs grouped by model — presented as both a visual chart and supporting data — so that I can quickly spot trends, identify which models drive my spending, and understand usage patterns over time.

**Why this priority**: Daily model-level granularity is the core analytical value of this feature. Combining the chart and data in a single view gives users both at-a-glance pattern recognition and detailed numbers without switching between views.

**Independent Test**: Can be fully tested by viewing the daily breakdown for the current month and verifying costs appear grouped by model in both chart and data form.

**Acceptance Scenarios**:

1. **Given** a user has API usage across multiple models in the current month, **When** they view the daily cost section, **Then** they see a chart displaying daily costs grouped by model with a legend identifying each model.
2. **Given** a user interacts with a chart data point (e.g., hover or tap), **When** the interaction occurs, **Then** a tooltip shows the exact cost and model breakdown for that day.
3. **Given** a user has usage on some days but not others, **When** they view the daily breakdown, **Then** days with no usage are either omitted or shown as $0.00, and the display remains clear and readable.
4. **Given** a user wants to understand cost trends, **When** they view the daily breakdown, **Then** the data is presented in a way that allows them to identify which days and models had the highest costs.

---

### Edge Cases

- What happens when the Claude Console API is temporarily unavailable? The system displays the last successfully fetched data with a timestamp and a notice that data may be stale.
- What happens when a user has usage from a model that is newly released and not yet known to the system? The system displays the model identifier as returned by the API without failing.
- What happens when token costs change mid-month due to pricing updates? The system reflects costs as reported by the Claude Console API (which applies the correct pricing at the time of usage).
- What happens if the user has extremely high usage (thousands of API calls per day)? The daily aggregation still performs well and displays correctly.
- What happens if the API key has insufficient permissions to access billing data? The system displays a specific error indicating the key lacks the required permissions.
- What happens when an admin views the detail page of a user who has not configured an API key? The cost tracking section shows an empty state indicating no API key has been configured (without prompting the admin to add one).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide each authenticated user with a personal profile page accessible via standard session authentication (no re-authentication required).
- **FR-002**: System MUST restrict profile page access so that users can only view their own profile data.
- **FR-003**: The profile page MUST display the user's personal information (name, email, role) in read-only format — no editing capabilities.
- **FR-004**: The profile page MUST display the user's currently assigned AI tools/licenses with tool name, tier, and assignment date in read-only format.
- **FR-005**: System MUST fetch and display the total cost for the current calendar month using the admin-configured API key.
- **FR-006**: System MUST fetch and display daily token costs grouped by model for the current month, presented as a visual chart with supporting data.
- **FR-007**: System MUST display costs in US dollars (the standard billing currency for Claude Console).
- **FR-008**: System MUST handle API errors gracefully, showing user-friendly error messages.
- **FR-009**: System MUST sync usage data via a cron job (external scheduler calling a dedicated API endpoint) that fetches all org usage in a single pass and maps results to individual users. Manual sync of a specific user MUST only be available to admins.
- **FR-010**: System MUST handle the case where a user has no API key configured (admin responsibility), showing a message to contact their administrator.
- **FR-011**: System MUST handle the case where a user has no API usage, showing an appropriate empty state.
- **FR-012**: System MUST show the date of the latest stored usage data.
- **FR-012a**: System MUST persist usage data permanently for long-term cost monitoring and trend analysis across months.
- **FR-013**: System MUST display a user's Claude API cost data on the admin user detail page, visible to admin users.
- **FR-014**: System MUST provide a "My Profile" link in the user avatar/menu dropdown in the header for navigating to the profile page.

### Key Entities

- **API Key Credential**: Represents a user's Claude Console API key. Linked to a single user account. Managed by admins using existing functionality. Used to authenticate requests to the Claude Console billing API.
- **Daily Cost Record**: Represents the aggregated cost for a specific day, model, and user. Includes date, model identifier, token counts (input and output), and computed cost in US dollars.
- **Monthly Cost Summary**: Represents the total cost for a user in a given calendar month. Derived by aggregating daily cost records.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can view their current month's total API cost within 3 seconds of navigating to the cost tracking section.
- **SC-002**: Users can identify their highest-cost model and highest-cost day within the current month in under 10 seconds.
- **SC-003**: Cost data displayed matches the Claude Console's reported costs with less than 1% variance (accounting for rounding).
- **SC-004**: Users with an admin-configured API key can see cost data immediately upon first visit to their profile page.
- **SC-005**: Users without an API key configured see a clear message directing them to contact their administrator.

## Assumptions

- The Claude Console provides an API or accessible endpoint that returns usage and billing data when authenticated with an API key. The specific API contract will be determined during planning.
- Costs are reported in US dollars, consistent with Anthropic's billing practices.
- The system already has user authentication in place (NextAuth.js). API keys are managed by admins using existing functionality — users do not store or update their own keys.
- Cost data granularity is at the daily level per model, as this is the standard granularity available from Claude Console billing.
- The system will persist fetched usage data permanently for long-term monitoring. Incremental sync fetches only new days. Data is served from the database, not the API, for page loads.
