# Feature Specification: GitHub User Enrichment

**Feature Branch**: `012-github-user-enrichment`
**Created**: 2026-03-06
**Status**: Draft
**Input**: User description: "Users should be enriched with data from GitHub. I want to be able to connect my GitHub organization and pull user data from the API."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect GitHub Organization (Priority: P1)

An admin connects their GitHub organization to the AI Developer Hub so that the system can discover and retrieve member data. The admin navigates to a settings or integrations page, provides a GitHub Personal Access Token (PAT) with the required organization scopes, selects which GitHub organization to connect, and confirms the connection. The system validates the token, verifies organization access, and stores the encrypted connection credentials.

**Why this priority**: Without an active GitHub organization connection, no enrichment or syncing can happen. This is the foundational capability that all other stories depend on.

**Independent Test**: Can be fully tested by providing a valid GitHub PAT, selecting an organization, and verifying the connection is persisted and the organization members can be listed.

**Acceptance Scenarios**:

1. **Given** the admin is on the GitHub integration settings page, **When** they enter a valid PAT with `read:org` and `read:user` scopes and select an organization, **Then** the system validates the token, confirms access, and stores the encrypted credentials.
2. **Given** the admin provides an invalid or expired PAT, **When** they attempt to connect, **Then** the system displays a clear error explaining what went wrong (invalid token, insufficient scopes, or no organization access).
3. **Given** a GitHub organization is already connected, **When** the admin views the integration settings, **Then** they see the connected organization name, connection status, and options to disconnect or update the token.
4. **Given** the admin has access to multiple GitHub organizations, **When** they set up the connection, **Then** they can select which organization to connect from a list of available organizations.

---

### User Story 2 - Sync GitHub Members to Users (Priority: P1)

An admin triggers a sync that pulls member data from the connected GitHub organization and matches members to existing users in the system (by GitHub username or email). For matched users, the system enriches their profiles with GitHub data. Unmatched GitHub members are presented for optional import as new users.

**Why this priority**: This is the core value proposition -- enriching user data from GitHub. Without syncing, the connection serves no purpose.

**Independent Test**: Can be fully tested by connecting a GitHub organization, triggering a sync, and verifying that existing users with matching GitHub usernames are enriched with GitHub profile data (avatar, name, bio).

**Acceptance Scenarios**:

1. **Given** a GitHub organization is connected, **When** the admin triggers a sync, **Then** the system fetches all organization members and displays a sync preview showing matched users, unmatched GitHub members, and unmatched system users.
2. **Given** the sync preview is displayed, **When** the admin confirms the sync, **Then** matched users are enriched with GitHub data (display name, avatar URL, bio, public repos count, GitHub profile URL) and the changes are recorded in change history.
3. **Given** a GitHub member's username matches an existing user's `githubUsername` field, **When** the sync runs, **Then** the member is automatically matched to that user.
4. **Given** a GitHub member's email matches an existing user's email, **When** the sync runs, **Then** the member is matched to that user and the `githubUsername` field is populated if it was empty.
5. **Given** unmatched GitHub members exist after sync, **When** the admin selects specific unmatched members, **Then** the admin can import them as new users with their GitHub data pre-filled.

---

### User Story 3 - View Enriched GitHub Data on User Profiles (Priority: P2)

When viewing a user's profile, the admin can see the enriched GitHub data alongside existing user information. This provides a richer picture of each team member without leaving the application.

**Why this priority**: Displaying enriched data completes the user-facing value loop. Without this, the synced data is stored but not surfaced.

**Independent Test**: Can be fully tested by navigating to a user detail page for a user with synced GitHub data and verifying the GitHub information section is visible with avatar, bio, profile link, and public repository count.

**Acceptance Scenarios**:

1. **Given** a user has enriched GitHub data, **When** an admin views the user detail page, **Then** a GitHub section displays the user's avatar, bio, GitHub profile link, and public repository count.
2. **Given** a user has no GitHub data, **When** an admin views the user detail page, **Then** no GitHub section is displayed (or a prompt to connect/match the user to a GitHub account is shown).
3. **Given** the GitHub data was last synced more than 24 hours ago, **When** an admin views the user detail page, **Then** a "last synced" indicator shows when the data was last refreshed.

---

### User Story 4 - Manage Organization Connection (Priority: P3)

An admin can disconnect a GitHub organization, update the access token (e.g., after rotation), or re-sync data on demand. The system supports managing the lifecycle of the GitHub integration.

**Why this priority**: Ongoing maintenance of the connection is important but secondary to initial setup and sync functionality.

**Independent Test**: Can be fully tested by disconnecting an organization and verifying the connection is removed, then reconnecting with a new token.

**Acceptance Scenarios**:

1. **Given** a GitHub organization is connected, **When** the admin disconnects it, **Then** the connection credentials are removed but previously enriched user data is retained.
2. **Given** the admin needs to rotate the PAT, **When** they update the token in integration settings, **Then** the system validates the new token and updates the stored credentials.
3. **Given** a GitHub organization is connected, **When** the admin triggers a manual re-sync, **Then** the system fetches the latest data and updates any changed fields (recording changes in history).

---

### Edge Cases

- What happens when a GitHub member is removed from the organization between syncs? The system should flag these users during the next sync but not automatically deactivate them.
- What happens when a user's GitHub username changes? The system should detect the mismatch during sync and present it for admin review.
- What happens when the GitHub API rate limit is exceeded during a large sync? The system should handle rate limiting gracefully, showing progress and resuming or retrying as needed.
- What happens when the stored PAT expires or is revoked? The system should detect the invalid token on the next sync attempt and notify the admin to update credentials.
- What happens when two system users match the same GitHub member? The system should flag the conflict and let the admin resolve the match manually.
- What happens when a GitHub member's username matches User A but their email matches User B? The username match takes priority (explicit link); the email conflict is flagged for admin review in the sync preview.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow admins to connect a GitHub organization by providing a Classic Personal Access Token (PAT) with `read:org` and `read:user` scopes and selecting an organization.
- **FR-002**: System MUST validate that the provided Classic PAT has the required scopes (`read:org`, `read:user`) and has access to the selected organization before saving the connection.
- **FR-003**: System MUST store GitHub connection credentials (PAT) encrypted at rest using the existing encryption infrastructure.
- **FR-004**: System MUST fetch organization member data from GitHub including: login (username), name, email, avatar URL, bio, public repos count, and profile URL.
- **FR-005**: System MUST match GitHub members to existing users by GitHub username first, then by email as a fallback. When a username match and email match point to different users, the username match takes priority and the email conflict is flagged for admin review.
- **FR-006**: System MUST present a sync preview before applying changes, showing matched users, unmatched GitHub members, and unmatched system users.
- **FR-007**: System MUST enrich matched user records with GitHub profile data (avatar URL, bio, public repos count, GitHub profile URL, GitHub user ID).
- **FR-008**: System MUST record all enrichment changes in the existing change history audit trail.
- **FR-009**: System MUST allow admins to import unmatched GitHub members as new system users with GitHub data pre-filled, assigned the `viewer` role, `active` status, and a temporary password.
- **FR-010**: System MUST display enriched GitHub data on the user detail page.
- **FR-011**: System MUST allow admins to disconnect an organization while retaining previously enriched user data.
- **FR-012**: System MUST allow admins to update the access token for a connected organization.
- **FR-013**: System MUST handle GitHub API rate limits gracefully, informing the admin of progress and any delays.
- **FR-014**: System MUST track when each user's GitHub data was last synced.
- **FR-015**: System MUST support only one connected GitHub organization at a time.
- **FR-016**: System MUST restrict all GitHub integration management actions to admin users only.

### Key Entities

- **GitHub Connection**: Represents the link between the system and a GitHub organization. Holds the encrypted access token, organization name/ID, connection status, and last sync timestamp.
- **GitHub Profile Data**: Enrichment data associated with a user, sourced from GitHub. Includes avatar URL, bio, public repository count, GitHub profile URL, GitHub user ID, and last synced timestamp.
- **Sync Event**: A record of each sync operation, capturing when it occurred, how many members were fetched, how many were matched/imported/unmatched, and the overall status (success, partial, failed).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Admins can connect a GitHub organization and complete the first sync within 5 minutes.
- **SC-002**: 90% or more of users with matching GitHub usernames are automatically matched during sync without manual intervention.
- **SC-003**: Enriched GitHub data is visible on user profiles within 3 seconds of page load.
- **SC-004**: The system successfully syncs organizations with up to 500 members in a single operation.
- **SC-005**: All enrichment changes are recorded in the audit trail with full before/after values.
- **SC-006**: Admins can identify unmatched GitHub members and import them as new users in under 2 minutes.

## Clarifications

### Session 2026-03-06

- Q: Which GitHub authentication method should be used (Classic PAT, Fine-grained PAT, or GitHub App)? → A: Classic PAT — simple scope-based token (`read:org`, `read:user`), well-established, no mandatory expiry.
- Q: What default role and status should imported GitHub members receive? → A: `viewer` role, `active` status — immediately usable with a temporary password, following the existing bulk import pattern.
- Q: How should cross-match conflicts be resolved (username matches User A, email matches User B)? → A: Username match wins; flag the email conflict for admin review but proceed with the username-matched user.

## Assumptions

- The GitHub REST API (not GraphQL) will be used for fetching organization and member data, as it is simpler and sufficient for the required data points.
- A single GitHub organization connection is sufficient; multi-organization support is out of scope for this feature.
- The existing encryption utility (`src/lib/crypto.ts`) will be reused for storing the GitHub PAT securely.
- GitHub usernames stored in the existing `githubUsername` field on the users table will be the primary matching key.
- The system will not perform automatic/scheduled syncs in this iteration; syncs are always manually triggered by an admin.
- Public GitHub profile data (name, avatar, bio, repos count) is sufficient; private repository data or contribution history is out of scope.
- The existing `circle` field may correlate with GitHub teams but automatic team-to-circle mapping is out of scope for this feature.
