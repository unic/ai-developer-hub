# Feature Specification: Profile API Preview

**Feature Branch**: `022-profile-api-preview`
**Created**: 2026-03-26
**Status**: Draft
**Input**: User description: "The profile API lets other applications integrate profile information into their application. This application needs an API preview section to verify the API is working and where you can pass the arguments to the API and have the JSON response properly visualized. The actual API should be used, not a simulation or similar. This can be added as a section in the settings."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Test Profile API with Email Lookup (Priority: P1)

An administrator navigates to the Settings area and finds an "API Preview" section. They enter a user's email address into the email field and click a button to send the request. The system calls the real `/api/profile` endpoint with the provided email and Bearer token, then displays the full JSON response in a formatted, syntax-highlighted view. The administrator can quickly confirm the API is functioning correctly and inspect the returned profile data, license assignments, and cost information.

**Why this priority**: This is the core value of the feature — verifying the API works and inspecting real responses. Without this, the feature has no purpose.

**Independent Test**: Can be fully tested by navigating to Settings > API Preview, entering a valid user email, submitting the request, and verifying the formatted JSON response appears with correct profile data.

**Acceptance Scenarios**:

1. **Given** an admin is on the Settings > API Preview section, **When** they enter a valid user email and submit, **Then** the system calls the real profile API and displays the formatted JSON response containing user info, assignments, and cost data.
2. **Given** an admin enters an email that does not exist, **When** they submit, **Then** the system displays the API's 404 error response in a clear, readable format.
3. **Given** an admin submits a request, **When** the API call is in progress, **Then** a loading indicator is displayed until the response arrives.

---

### User Story 2 - Filter by Month Parameter (Priority: P2)

An administrator wants to inspect cost data for a specific month. In the API Preview section, they enter the user's email and optionally select or type a month value in `YYYY-MM` format. The request is sent with both parameters, and the response shows cost data scoped to that month.

**Why this priority**: The month parameter is the only optional argument of the API. Supporting it completes the full parameter coverage and lets admins verify month-specific cost data.

**Independent Test**: Can be tested by entering a valid email plus a month value (e.g., `2026-01`), submitting, and confirming the response's `costData.month` field matches the requested month.

**Acceptance Scenarios**:

1. **Given** an admin enters both email and a month value, **When** they submit, **Then** the response includes cost data filtered to the specified month.
2. **Given** an admin enters only an email (no month), **When** they submit, **Then** the response returns cost data for the current month by default.
3. **Given** an admin enters an invalid month format (e.g., `March 2026`), **When** they submit, **Then** the system shows a validation error before sending the request.

---

### User Story 3 - Copy and Inspect Response (Priority: P3)

An administrator inspects the API response and wants to share it or use it externally. They can copy the raw JSON to their clipboard with a single click. The response view also allows collapsing and expanding nested sections (user, assignments, costData) so they can focus on the part they care about.

**Why this priority**: Enhances usability but the core verify-and-view flow works without it.

**Independent Test**: Can be tested by submitting a request, clicking the copy button, pasting into a text editor, and confirming valid JSON. Collapsible sections can be tested by clicking to expand/collapse each top-level key.

**Acceptance Scenarios**:

1. **Given** a JSON response is displayed, **When** the admin clicks the copy button, **Then** the full raw JSON is copied to the clipboard and a confirmation message appears.
2. **Given** a JSON response is displayed, **When** the admin clicks on a collapsible section header (e.g., "costData"), **Then** that section collapses or expands to show/hide its contents.

---

### Edge Cases

- What happens when the API secret is not configured in the environment? The preview section displays a clear message indicating the API is not available due to missing configuration.
- What happens when the API server is unreachable or returns a network error? The section displays the error in a user-friendly format rather than failing silently.
- What happens when the response payload is very large (e.g., many daily breakdown entries)? The JSON viewer handles large responses without freezing the page.
- What happens when the admin submits a request with an empty email field? The system shows an inline validation error and does not send the request.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide an "API Preview" section within the Settings area, accessible to administrators only.
- **FR-002**: System MUST present an input field for the `email` parameter (required) and an input field for the `month` parameter (optional, `YYYY-MM` format).
- **FR-003**: System MUST call the real profile API endpoint using the configured Bearer token when the admin submits a request — no mocked or simulated data.
- **FR-004**: System MUST display the full JSON response with syntax highlighting and proper indentation.
- **FR-005**: System MUST show the HTTP status code and response time alongside the response body.
- **FR-006**: System MUST validate the email format and month format on the client side before sending the request.
- **FR-007**: System MUST display API error responses (400, 404, 500) in the same formatted JSON view with a visual indicator of the error status.
- **FR-008**: System MUST show a loading state while the API request is in progress.
- **FR-009**: System MUST provide a button to copy the raw JSON response to the clipboard.
- **FR-010**: System MUST allow collapsing and expanding top-level sections of the JSON response.
- **FR-011**: System MUST display a configuration warning when the API secret is not set, preventing request submission.
- **FR-012**: System MUST restrict the API Preview section to admin users only.

### Key Entities

- **API Request**: A preview request consisting of email (required), month (optional), and the target endpoint URL.
- **API Response**: The full HTTP response including status code, response time, and JSON body returned by the profile endpoint.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Administrators can send a test request and view the formatted response within 5 seconds of page interaction (excluding API processing time).
- **SC-002**: 100% of profile API parameters (email, month) are exposed and testable through the preview interface.
- **SC-003**: Administrators can distinguish between successful and error responses at a glance through visual status indicators.
- **SC-004**: Response data can be copied to clipboard in one click, preserving valid JSON formatting.
- **SC-005**: The preview section is only visible and accessible to admin users; non-admin users cannot access it.

## Assumptions

- The `PROFILE_API_SECRET` environment variable is already configured in the deployment environment. The preview section will use this existing secret for Bearer token authentication.
- The API Preview section will be added as a new subsection within the existing Settings layout, following the established navigation pattern (Appearance, Integrations, Sync, and now API Preview).
- Only admin users need access to the API Preview — this is a developer/admin tool, not an end-user feature.
- The preview makes requests from the server side (via a server action) to avoid exposing the Bearer token to the client browser.
