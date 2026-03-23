# Feature Specification: Profile API

**Feature Branch**: `020-profile-api`
**Created**: 2026-03-23
**Status**: Draft
**Input**: User description: "The profile added in a previous feature should now also be exposed as an API for other tools to visualize the data. The external system only knows the e-mail address of the profile to show. The new API should have a protection layer."

## Clarifications

### Session 2026-03-23

- Q: How should API authentication work? → A: Environment variable with Bearer token, same pattern as cron job protection (`requireCronSecret`). No key management UI needed.
- Q: Should cost tracking data be optional or always included? → A: Cost tracking is crucial — always include it in the response when available.
- Q: Should the API use the same `CRON_SECRET` or a dedicated env var? → A: Dedicated env var (`PROFILE_API_SECRET`) — independent rotation and revocation, principle of least privilege.
- Q: Should cost data cover only current month or allow requesting a specific month? → A: Optional month parameter (defaults to current month) — supports historical views.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - External Tool Retrieves Profile by Email (Priority: P1)

An external tool (e.g., a dashboard, internal portal, or reporting system) needs to display a user's profile information. The tool knows only the user's email address. It sends an authenticated request to the Profile API with the email address and receives the user's profile data including their role, circle, assigned AI tools, and cost tracking data.

**Why this priority**: This is the core value proposition — without the ability to retrieve profile data by email, the entire feature has no purpose.

**Independent Test**: Can be fully tested by sending an authenticated GET request with a valid email and verifying the response contains the expected profile fields including cost data.

**Acceptance Scenarios**:

1. **Given** an external tool has the correct Bearer token and a known user email, **When** it requests the profile for that email, **Then** the system returns the user's profile data (name, email, role, circle, profile type, assigned tools, and cost tracking data).
2. **Given** an external tool has the correct Bearer token and an email that does not exist in the system, **When** it requests the profile for that email, **Then** the system returns a "not found" response with no data leakage.
3. **Given** an external tool has the correct Bearer token and a valid email, **When** it requests the profile, **Then** the response includes the user's tool assignments with tool name, tier, status, and assignment date.
4. **Given** an external tool requests a profile for a user with Claude API usage, **When** the request succeeds without a month parameter, **Then** the response includes the current month's cost summary (monthly total and daily breakdown).
5. **Given** an external tool requests a profile for a user with no Claude API usage, **When** the request succeeds, **Then** the response includes the cost section with zero values rather than omitting it.
6. **Given** an external tool requests a profile with a specific month parameter (e.g., "2026-02"), **When** the user has usage data for that month, **Then** the response includes cost data for the requested month.

---

### User Story 2 - API Access Protection via Environment Secret (Priority: P1)

The API is protected by a shared secret configured as an environment variable. External tools pass this secret as a Bearer token in the Authorization header — the same pattern used for cron job protection. Requests without the correct token are rejected.

**Why this priority**: Security is equally critical as functionality — exposing profile data without protection would be a compliance and privacy risk.

**Independent Test**: Can be tested by sending requests with missing, incorrect, and correct Bearer tokens and verifying appropriate accept/reject behavior.

**Acceptance Scenarios**:

1. **Given** a request without an Authorization header, **When** it reaches the Profile API, **Then** the system rejects the request with a 401 unauthorized error.
2. **Given** a request with an incorrect Bearer token, **When** it reaches the Profile API, **Then** the system rejects the request with a 401 unauthorized error.
3. **Given** a request with the correct Bearer token matching the environment variable, **When** it reaches the Profile API, **Then** the system processes the request and returns data.
4. **Given** the environment variable is not configured, **When** any request reaches the Profile API, **Then** the system rejects the request with a 401 unauthorized error (fail-closed).

---

### Edge Cases

- What happens when the email matches an inactive user? The system returns the profile with the inactive status clearly indicated.
- What happens when the profile has no tool assignments? The system returns an empty assignments list, not an error.
- What happens when the user has no Anthropic license or API key configured? The cost section indicates data is unavailable with a reason, rather than failing the entire request.
- What happens when the email format is invalid? The system returns a validation error without querying for the user.
- What happens when the environment secret is not set? The API rejects all requests (fail-closed behavior).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST expose a read-only endpoint that accepts an email address and returns the matching user's profile data.
- **FR-002**: System MUST authenticate all API requests using a Bearer token in the Authorization header, validated against a dedicated `PROFILE_API_SECRET` environment variable (separate from `CRON_SECRET`).
- **FR-003**: System MUST reject requests with missing or incorrect Bearer tokens with a 401 unauthorized response.
- **FR-004**: System MUST reject all requests when the environment variable is not configured (fail-closed).
- **FR-005**: System MUST return profile data including: user name, email, role, circle, profile type, and status.
- **FR-006**: System MUST return the user's AI tool assignments (tool name, tier, assignment date, status) as part of the profile response.
- **FR-007**: System MUST include cost tracking data (monthly total and daily breakdown) in the response when the user has an active Anthropic integration.
- **FR-008**: System MUST include a cost section with zero/unavailable indicators when the user has no cost data, rather than omitting the section.
- **FR-012**: System MUST accept an optional month parameter (format: YYYY-MM) to return cost data for a specific month; when omitted, defaults to the current month.
- **FR-009**: System MUST return a "not found" response when the email does not match any user, without revealing whether the email exists in other contexts.
- **FR-010**: System MUST validate the email format before processing the lookup.
- **FR-011**: System MUST return consistent, structured error responses for all failure cases (unauthorized, not found, validation error).

### Key Entities

- **Profile Response**: A read-only projection of user data combining information from the user record, their tool assignments, and their cost tracking data. Not a stored entity — assembled on request.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: External tools can retrieve a complete user profile (including cost data) by email in under 2 seconds.
- **SC-002**: Unauthenticated or improperly authenticated requests are rejected 100% of the time.
- **SC-003**: The API handles at least 100 requests per minute without degradation.
- **SC-004**: Profile data returned by the API matches the data shown on the internal profile page with no discrepancies.
- **SC-005**: All error responses follow a consistent structure and include actionable information for the consuming tool.

## Assumptions

- A dedicated `PROFILE_API_SECRET` environment variable (Bearer token pattern) provides independent access control, consistent with the existing cron job protection pattern but separately rotatable.
- The API is read-only — external tools cannot modify profile data.
- Cost data is always included when available. An optional month parameter allows historical lookups; defaults to current month.
- The existing profile data assembly logic can be reused for the API response.
- The API route will be excluded from NextAuth middleware, similar to existing cron/sync routes.

## Scope Boundaries

### In Scope
- Profile lookup by email via Bearer-token-authenticated API
- Returning user profile, tool assignments, and cost tracking data
- Structured error responses

### Out of Scope
- API key management UI (authentication uses a static environment variable)
- Write operations (creating/updating profiles via API)
- Bulk profile lookup (multiple emails in one request)
- Webhook/push notifications to external tools
- Rate limiting (deferred — env var auth limits exposure to known integrators)
- API versioning strategy (deferred; this spec assumes an unversioned `/api/profile` endpoint)
- External tool registration or OAuth2 flows
