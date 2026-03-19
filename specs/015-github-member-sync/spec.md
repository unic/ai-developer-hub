# Feature Specification: GitHub Member Sync — Manual Matching

**Feature Branch**: `015-github-member-sync`
**Created**: 2026-03-10
**Status**: Draft
**Input**: User description: "Syncing github members list the unmatched users before approving. The sync process should give the option to manually match github users to users in the application. The github information is then added to the users to keep the connection in the future. The goal is to minimize unmatched users from the system."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Review Unmatched GitHub Members Before Sync (Priority: P1)

As an admin, after fetching a GitHub org member sync preview, I want to see a clear list of unmatched GitHub members alongside unmatched application users so I can decide how to resolve each one before confirming the sync.

**Why this priority**: Without visibility into unmatched members, admins blindly import duplicates or miss existing users who should be linked. This is the foundation for the entire feature.

**Independent Test**: Can be fully tested by triggering a sync preview with known unmatched members and verifying the unmatched list renders correctly with GitHub avatars, usernames, and suggested matches.

**Acceptance Scenarios**:

1. **Given** a connected GitHub org with 20 members where 5 have no auto-match, **When** the admin triggers a sync preview, **Then** the preview displays a dedicated "Unmatched Members" section listing all 5 unmatched GitHub members with their avatar, username, and profile URL.
2. **Given** the unmatched members list is displayed, **When** the admin views each unmatched member, **Then** the system shows suggested application users ranked by similarity (name, email domain) alongside a manual search option.
3. **Given** no unmatched members exist after auto-matching, **When** the admin views the sync preview, **Then** the "Unmatched Members" section is hidden or shows a success message indicating all members are matched.

---

### User Story 2 — Manually Match a GitHub Member to an Existing User (Priority: P1)

As an admin, I want to manually match an unmatched GitHub member to an existing application user so that the GitHub identity is linked to that user permanently, preventing future mismatches.

**Why this priority**: This is the core interaction that directly reduces unmatched users. Without it, the only option is importing as new users, which creates duplicates.

**Independent Test**: Can be fully tested by selecting an unmatched GitHub member, searching for and selecting an application user, confirming the match, and verifying the link persists across subsequent syncs.

**Acceptance Scenarios**:

1. **Given** an unmatched GitHub member "octocat" is listed, **When** the admin clicks "Match to existing user" and searches for "John", **Then** the system displays matching application users filtered by name and the admin can select one.
2. **Given** the admin selects application user "John Doe" to match with "octocat", **When** the admin confirms the match, **Then** the system stores the GitHub username on the user record and moves the member from "unmatched" to "matched" in the preview.
3. **Given** a GitHub member was manually matched in a previous sync, **When** a new sync is triggered, **Then** the member auto-matches to the same application user via the stored GitHub username.
4. **Given** the admin attempts to match a GitHub member to a user that already has a different GitHub username linked, **When** the match is attempted, **Then** the system warns the admin about the existing link and asks for confirmation to overwrite.

---

### User Story 3 — Create New User Directly From Unmatched GitHub Member (Priority: P1)

As an admin, when an unmatched GitHub member has no corresponding application user, I want to create a new system user directly from the sync preview with the name and GitHub username pre-filled from GitHub, so the member is immediately linked without leaving the sync flow.

**Why this priority**: This completes the resolution options — admins can match to existing users or create new ones inline. Without it, admins must leave the sync, create a user manually, then return to retry the sync.

**Independent Test**: Can be fully tested by selecting "Create new user" for an unmatched GitHub member, verifying the form is pre-filled with the GitHub member's name and username, submitting, and confirming the new user appears as matched in the preview.

**Acceptance Scenarios**:

1. **Given** an unmatched GitHub member "octocat" with display name "Octo Cat", **When** the admin selects "Create new user", **Then** an inline form appears pre-filled with the name ("Octo Cat") and GitHub username ("octocat") from the GitHub profile.
2. **Given** the inline creation form is shown, **When** the admin reviews the pre-filled fields and provides any required additional fields (e.g., email), **Then** the admin can submit and the new user is created with the GitHub username already linked.
3. **Given** a new user was created via the inline form, **When** the sync preview updates, **Then** the GitHub member moves from "unmatched" to "matched" and the new user appears in the application's user list with the GitHub username persisted.
4. **Given** the GitHub member has a public email on their profile, **When** the inline creation form is shown, **Then** the email field is also pre-filled from the GitHub profile (editable by the admin).

---

### User Story 4 — Bulk Resolution of Unmatched Members (Priority: P2)

As an admin syncing a large organization, I want to efficiently resolve multiple unmatched members in one session without navigating away from the sync preview, so the process doesn't become tedious.

**Why this priority**: For organizations with many members, one-by-one matching would be impractical. Batch workflow keeps the process manageable.

**Independent Test**: Can be tested by presenting 10+ unmatched members and verifying the admin can match several, skip others, and create new users for some — all within the same preview screen.

**Acceptance Scenarios**:

1. **Given** 15 unmatched GitHub members are listed, **When** the admin resolves each one (match to existing user, create new user, or skip), **Then** the preview updates in real-time showing remaining unmatched count and resolution summary.
2. **Given** the admin has resolved some but not all unmatched members, **When** the admin clicks "Confirm Sync", **Then** the system displays a confirmation dialog summarizing the unresolved count (e.g., "5 members remain unresolved. Continue?"). Upon confirmation, the system processes matched members (linking GitHub identities), creates new users for members marked for creation, and leaves unresolved members unmatched in the sync report.
3. **Given** the admin is resolving unmatched members, **When** the admin wants to undo a match or creation before confirming, **Then** the admin can remove the pending resolution and the member returns to the unmatched list.

---

### User Story 5 — Persistent GitHub Identity Reduces Future Mismatches (Priority: P2)

As an admin performing recurring syncs, I want the number of unmatched members to decrease over time as manual matches accumulate, so each sync requires less manual intervention.

**Why this priority**: This is the long-term value proposition. Each manual match is an investment that pays off in every future sync.

**Independent Test**: Can be tested by performing two consecutive syncs — the first with manual matches, the second verifying those members auto-match without intervention.

**Acceptance Scenarios**:

1. **Given** the admin manually matched 5 members in a previous sync, **When** a new sync is triggered, **Then** all 5 previously matched members appear in the "matched" category automatically.
2. **Given** a user's GitHub username was set via manual matching, **When** viewing the user's profile in the application, **Then** the GitHub username is visible and editable by admins.
3. **Given** the sync history page, **When** the admin reviews past syncs, **Then** the matched/unmatched/imported counts show a trend of decreasing unmatched members over time.

---

### Edge Cases

- What happens when a GitHub member's username has changed since the last sync? The system should match by stored GitHub username (case-insensitive) and update the display name if it changed.
- What happens when an application user is matched to a GitHub member but the user is later deactivated? Inactive users should still retain their GitHub link but not count as "matched active users."
- What happens when two application users could plausibly match the same GitHub member? The system should show all candidates and let the admin choose, with a warning about ambiguity.
- What happens when the admin cancels the sync after making manual matches but before confirming? All pending matches are discarded; no changes are persisted until the admin explicitly confirms.
- What happens when the GitHub API rate limit is hit while enriching profiles for the matching suggestions? The system should gracefully degrade by showing matches based on available data and notifying the admin about the rate limit.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display all unmatched GitHub members in a dedicated section of the sync preview, showing each member's avatar, username, and profile link.
- **FR-002**: System MUST suggest up to 3 potential application user matches for each unmatched GitHub member, ranked by similarity (name similarity, email domain match). Admins can use the search (FR-003) to find matches beyond the top 3.
- **FR-003**: System MUST allow admins to search application users by name or email when manually matching an unmatched GitHub member. Search results MUST include both active and inactive users, with inactive users visually distinguished and sorted below active users.
- **FR-004**: System MUST allow admins to manually link an unmatched GitHub member to an existing application user from the sync preview.
- **FR-005**: When a manual match is confirmed during sync, the system MUST store the GitHub username on the matched application user's record for future auto-matching.
- **FR-006**: System MUST allow admins to resolve each unmatched member as one of: match to existing user, create new user, or skip.
- **FR-006a**: When creating a new user from an unmatched GitHub member, the system MUST pre-fill the user's name from the GitHub profile display name and persist the GitHub username on the new user record. If the GitHub member has a public email, the email field MUST also be pre-filled (editable by admin).
- **FR-006b**: New user creation MUST happen inline within the sync preview via a compact form — the admin MUST NOT need to navigate away from the sync flow.
- **FR-007**: System MUST show a real-time summary of resolution progress (e.g., "8 of 12 unmatched members resolved").
- **FR-008**: System MUST allow admins to undo a pending match before the sync is confirmed.
- **FR-008a**: When confirming a sync with unresolved unmatched members, the system MUST display a confirmation dialog showing the number of unresolved members before proceeding.
- **FR-009**: System MUST warn admins when matching a GitHub member to a user that already has a different GitHub username linked, requiring explicit confirmation to overwrite.
- **FR-010**: System MUST record all manual matches in the audit trail (change history) when the sync is confirmed.
- **FR-011**: System MUST update the sync event metrics to separately track manually matched members vs. auto-matched members.
- **FR-012**: Previously manually matched users MUST auto-match in subsequent syncs via their stored GitHub username.

### Key Entities

- **Unmatched GitHub Member**: A GitHub organization member who could not be automatically matched to any application user by username or email. Key attributes: GitHub username, avatar URL, profile URL, name, email (if public).
- **Match Suggestion**: A ranked candidate pairing between an unmatched GitHub member and an application user. Key attributes: confidence score, match reason (name similarity, email domain), application user reference.
- **Pending Match**: A temporary association between a GitHub member and an application user, created during the sync preview and committed only when the admin confirms the sync. Key attributes: GitHub member, application user (if matching to existing), resolution type (match to existing / create new user / skip).
- **Inline User Creation**: A new system user created directly from the sync preview, with fields pre-filled from the GitHub member's profile (name, username, email if public). The GitHub username is automatically persisted on the new user.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Admins can resolve all unmatched GitHub members (match, skip, or import) within the sync preview without navigating to other pages.
- **SC-002**: The number of unmatched members decreases by at least 80% after the second sync of the same organization (assuming manual matches were made during the first sync).
- **SC-003**: Admins can manually match an unmatched member to an existing user in under 15 seconds per member (search, select, confirm).
- **SC-004**: All manual matches persist across syncs — a member matched once never appears as unmatched again (unless the link is explicitly removed).
- **SC-005**: The sync preview clearly communicates the state of every GitHub member (auto-matched, manually matched, marked for import, skipped, or unresolved) at all times.
- **SC-006**: 100% of manual match operations are recorded in the audit trail with before/after values.

## Clarifications

### Session 2026-03-10

- Q: Should inactive/deactivated application users appear in the manual match search results? → A: Both active and inactive users appear, with inactive users visually marked and sorted lower.
- Q: Should the system require acknowledgment when confirming sync with unresolved unmatched members? → A: Show a confirmation dialog summarizing the unresolved count before proceeding.
- Q: How many match suggestions should be shown per unmatched GitHub member? → A: Top 3 suggestions per member; search serves as fallback.
- Q: How should "create new user" work for unmatched members with no system user? → A: Inline form in sync preview, pre-filled with GitHub name and username; GitHub username persisted on new user automatically.

## Assumptions

- The existing GitHub connection and auto-matching logic (by username and email) remains unchanged; this feature extends the flow for unmatched members only.
- The `githubUsername` field on the user model is the primary link for future auto-matching. No additional linking table is needed since `githubProfiles` already stores enriched data.
- Match suggestions use client-side similarity scoring (e.g., string distance on names, domain matching on emails) rather than a server-side ML model.
- The manual matching UI is part of the existing sync preview page, not a separate workflow.
- Admins are the only role that can perform sync operations and manual matching (consistent with existing `requireAdmin()` checks).
- The "skip" resolution means the GitHub member will appear as unmatched again in the next sync (no permanent ignore list in this iteration).
