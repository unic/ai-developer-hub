# Feature Specification: Reliable Cron Job Authentication & Coverage

**Feature Branch**: `018-fix-cron-auth`
**Created**: 2026-03-20
**Status**: Draft
**Input**: User description: "The cron jobs should work reliably and missing ones should be added. The existing cron jobs are getting redirected to the login page, which makes them not work. They need to have a way to get passed the auth."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cron Jobs Bypass Auth Redirect (Priority: P1)

As the system operator, automated scheduled jobs must execute their sync logic without being intercepted by the user authentication layer and redirected to the login page.

**Why this priority**: Without this fix, all scheduled data syncs are silently failing. No billing data, no usage metrics — the entire automated pipeline is broken. This is the root cause.

**Independent Test**: Can be fully tested by triggering a cron endpoint with the correct secret key and verifying it returns sync results (not a redirect to the login page), delivering confirmed automated data collection.

**Acceptance Scenarios**:

1. **Given** a cron job is scheduled and the correct secret is provided, **When** the job fires at its scheduled time, **Then** the job completes successfully and returns a 200 response with sync results.
2. **Given** the user authentication middleware is active, **When** a cron endpoint is called with a valid secret, **Then** the request is NOT redirected to the login page.
3. **Given** a cron endpoint is called WITHOUT a valid secret, **When** the request arrives, **Then** the system returns a 401 Unauthorized response (not a redirect).

---

### User Story 2 - GitHub Copilot Sync Runs on Schedule (Priority: P2)

As the system operator, the GitHub Copilot billing sync should run daily without manual intervention, pulling the latest seat usage and billing data into the system.

**Why this priority**: Accurate Copilot billing data depends on this scheduled sync. Without it, administrators see stale or missing cost data.

**Independent Test**: Can be fully tested by triggering the Copilot sync endpoint with the correct secret and confirming billing data is updated in the system.

**Acceptance Scenarios**:

1. **Given** the Copilot sync is triggered (scheduled or manual), **When** valid GitHub credentials are configured, **Then** the sync fetches the latest billing data and stores it successfully.
2. **Given** a sync is already in progress, **When** a second sync attempt arrives, **Then** the system rejects the duplicate and returns an appropriate conflict response.
3. **Given** a stale in-progress sync older than 10 minutes exists, **When** a new sync attempt arrives, **Then** the stale record is cleaned up and the new sync proceeds.

---

### User Story 3 - Anthropic API Usage Sync Runs on Schedule (Priority: P2)

As the system operator, the Anthropic (Claude) API usage metrics should sync every 10 minutes without manual intervention, keeping cost dashboards current.

**Why this priority**: Near-real-time Claude API cost tracking requires frequent automated syncs. Without it, cost dashboards are perpetually stale.

**Independent Test**: Can be fully tested by triggering the Anthropic sync endpoint with the correct secret and confirming usage metrics are updated.

**Acceptance Scenarios**:

1. **Given** the Anthropic sync is triggered on schedule, **When** valid API credentials are configured, **Then** the sync fetches the latest usage metrics and stores them successfully.
2. **Given** the sync endpoint is called, **When** it completes, **Then** a summary of records synced is returned.
3. **Given** the sync fails due to an upstream error, **When** the error occurs, **Then** the system logs the failure and returns an appropriate error response without crashing.

---

### User Story 4 - Missing Cron Jobs Are Added (Priority: P3)

As the system operator, any scheduled operations that exist in code but are not registered in the scheduling configuration should be added so they run automatically.

**Why this priority**: A discrepancy between what is configured to run and what should run creates silent gaps in data collection. This story ensures the scheduled job list is complete.

**Independent Test**: Can be fully tested by auditing the list of sync-capable endpoints against the scheduled job configuration and confirming all are registered.

**Acceptance Scenarios**:

1. **Given** a sync endpoint exists in the system, **When** the scheduled job configuration is reviewed, **Then** all sync endpoints appear in the configuration with appropriate schedules.
2. **Given** a new sync job is added to the configuration, **When** its scheduled time arrives, **Then** it executes and bypasses authentication correctly.

---

### Edge Cases

- What happens when the secret key is missing from the environment entirely? The system should fail safely (treat as unauthorized) without exposing error details.
- What happens when a cron job is triggered manually (e.g., via curl) with a valid secret? It should behave identically to the scheduled invocation.
- What happens when two cron schedules overlap or run concurrently? Each job should handle concurrency independently without interference.
- What happens when the upstream data source (GitHub API, Anthropic API) is unreachable? The job should fail with a logged error and return a 500 response without entering an inconsistent state.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The authentication middleware MUST allow requests to cron job endpoints to pass through without redirecting to the login page, provided the request carries a valid secret token.
- **FR-002**: Cron endpoints MUST validate the incoming secret token and return a 401 Unauthorized response (not a redirect) when the token is absent or incorrect.
- **FR-003**: The GitHub Copilot billing sync MUST run on its defined daily schedule and complete without requiring a logged-in user session.
- **FR-004**: The Anthropic API usage sync MUST run on its defined frequent schedule and complete without requiring a logged-in user session.
- **FR-005**: All sync endpoints that exist in the system MUST be registered in the scheduled job configuration with an appropriate execution frequency.
- **FR-006**: Cron jobs MUST be idempotent — running the same job multiple times within a short window MUST NOT produce duplicate data or corrupt existing records.
- **FR-007**: When a cron job fails, the system MUST return a structured error response and log enough detail to diagnose the failure without exposing sensitive credentials.
- **FR-008**: Stale or stuck in-progress sync records MUST be automatically cleaned up before a new sync attempt begins.

### Key Entities

- **Cron Secret**: A shared secret token known to the scheduling platform and the application; used to authenticate automated job requests without a user session.
- **Sync Job**: A scheduled automated task that fetches data from an external source and persists it in the application's data store.
- **Sync Status Record**: A record tracking the current state of a sync operation (in-progress, completed, failed) used to prevent duplicate concurrent runs.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All configured cron jobs complete successfully on every scheduled execution (0% redirect-to-login failures after fix is deployed).
- **SC-002**: Cron endpoints respond with a structured JSON result within 30 seconds for normal sync operations.
- **SC-003**: No cron endpoint can be invoked without a valid secret — 100% of unauthorized requests receive a 401 response.
- **SC-004**: All sync-capable endpoints are represented in the scheduled job configuration — 0 unregistered sync endpoints remain after this feature ships.
- **SC-005**: Duplicate sync prevention works correctly — concurrent invocations result in at most 1 active sync per job type.

## Assumptions

- The scheduling platform (Vercel Cron) sends a `Authorization: Bearer {secret}` header with every cron invocation when `CRON_SECRET` is configured in the environment.
- The application already has a working secret validation helper; the issue is the authentication middleware intercepting requests before the handler can check the secret.
- Middleware exclusion of cron routes is sufficient to resolve the redirect issue — no additional session-based auth is needed for these machine-to-machine endpoints.
- "Missing cron jobs" refers to sync endpoints that exist in code but are not listed in the scheduler configuration, not entirely new features to be built.
