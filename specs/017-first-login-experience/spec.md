# Feature Specification: First Login Experience

**Feature Branch**: `017-first-login-experience`
**Created**: 2026-03-17
**Status**: Draft
**Input**: User description: "As a user, my first login experience should allow me to set a password. It should be protected against abuse by other users. As an admin, I want to reset a users password, so they can go through the password setting process again. The protected view where you set your password or login should be modern, visually pleasing and with a good user experience. Avoid having multiple sign in buttons. The process must be fully self-service. Admins should have full control over when invite emails are sent — never automatic."

## Clarifications

### Session 2026-03-17

- Q: How does the first admin log in after deployment if all users are flagged as pending? → A: The seed admin account is exempt from the migration and keeps their existing password.
- Q: What does a pending user see when they try to sign in at the normal login form? → A: A specific message: "Account not yet set up — use your invite link or contact your admin."
- Q: Should batch email sending (Send Invites to All Pending Users) be synchronous or asynchronous? → A: Synchronous with a progress indicator — admin waits and sees final summary when complete.
- Q: Should password setup enforce complexity beyond minimum 8 characters? → A: No — minimum 8 characters only, matching existing validation and NIST guidelines.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Self-Service Password Setup via Invite Link (Priority: P1)

As a newly created user, I receive a secure, one-time invite link that takes me directly to a password setup page where I create my own password — without needing any temporary password or admin involvement beyond initial account creation.

When an admin creates a user account, the system generates a unique, cryptographically secure invite token. The admin can immediately copy the invite link, or choose to send an invite email to the user. The user opens the link (from the email or shared directly) and lands on a dedicated password setup page. The page validates the token, shows who the account belongs to (e.g., "Welcome, Jane — set your password to get started"), and lets the user create their password. Once set, the token is consumed, the account is fully activated, and the user is signed in and redirected to the dashboard.

**Why this priority**: This is the core feature. It eliminates temporary passwords entirely, making onboarding fully self-service and secure.

**Independent Test**: Can be fully tested by creating a user, sending the invite email (or copying the link), opening it in a browser, setting a password, and verifying access to the dashboard.

**Acceptance Scenarios**:

1. **Given** an admin creates a new user account, **When** the account is saved, **Then** a unique invite link is generated and displayed to the admin with options to copy the link or send an invite email.
2. **Given** a user with a valid invite link, **When** they open the link (from email or direct share), **Then** they see a password setup page that greets them by name and lets them create a password.
3. **Given** a user on the password setup page, **When** they enter a valid password and confirmation, **Then** their password is saved, the invite token is consumed, and they are signed in and redirected to the dashboard.
4. **Given** a user on the password setup page, **When** they enter mismatched passwords or a password not meeting requirements, **Then** they see clear, inline validation errors and remain on the setup page.
5. **Given** a user who has already set their password via the invite link, **When** they visit the same link again, **Then** they see a message that the link has already been used, with a prompt to sign in instead.

---

### User Story 2 - Unified Modern Authentication Page (Priority: P1)

As a user, I see a single, modern authentication experience that handles both sign-in and first-time password setup, so that the experience feels polished and intuitive regardless of my account state.

The sign-in page is redesigned to be visually modern and engaging. There is one sign-in form with one button — no multiple sign-in options. The password setup page (reached via invite link) shares the same visual design language, creating a cohesive authentication experience. Both pages use the application's theme system and are consistent with the product identity.

**Why this priority**: The user explicitly requested a modern, visually pleasing experience with no multiple sign-in buttons. Design quality is a core requirement, not polish — it's the feature.

**Independent Test**: Can be tested by navigating to the login page and the invite link page, verifying visual quality, responsiveness, and design consistency between the two views.

**Acceptance Scenarios**:

1. **Given** any user visiting the sign-in page, **When** the page loads, **Then** they see a single, modern sign-in form with email and password fields and one sign-in button.
2. **Given** the sign-in page and the password setup page, **When** compared side by side, **Then** they share a consistent visual design language (layout, typography, color, spacing).
3. **Given** either authentication page, **When** viewed on mobile, tablet, and desktop, **Then** the layout is fully responsive and visually polished at all breakpoints.
4. **Given** either authentication page, **When** the system theme is light or dark, **Then** the design adapts correctly and maintains visual quality.

---

### User Story 3 - Admin-Controlled Invite Emails (Priority: P2)

As an admin, I want full control over when invite emails are sent, so I can choose to email users their setup link or share it manually — the system never sends emails automatically.

After creating a user or resetting a password, the admin sees the invite link with two options: "Copy Link" and "Send Invite Email". Emails are only sent when the admin explicitly clicks "Send Invite Email". The invite email contains a branded message with the user's name, a clear call-to-action button linking to the password setup page, and information about the link's expiration. The admin can also send (or re-send) invite emails later from the user management screen for any user who hasn't completed password setup.

**Why this priority**: Email delivery is a key part of the self-service experience but must remain under admin control. This depends on the core invite link infrastructure (P1).

**Independent Test**: Can be tested by creating a user, choosing to send an invite email, and verifying the email arrives with the correct link. Then testing that no email is sent when only "Copy Link" is used.

**Acceptance Scenarios**:

1. **Given** an admin has just created a user or reset a password, **When** they see the invite link, **Then** they have distinct "Copy Link" and "Send Invite Email" options.
2. **Given** an admin clicks "Send Invite Email", **When** the email is sent, **Then** the user receives a branded email with their name, a setup link button, and expiration information, and the admin sees a success confirmation.
3. **Given** an admin clicks only "Copy Link" and does not send an email, **When** the dialog closes, **Then** no email is sent to the user.
4. **Given** a user who hasn't completed password setup, **When** an admin views that user in user management, **Then** there is an option to send (or re-send) the invite email.
5. **Given** an admin sends an invite email, **When** the email fails to deliver (service error), **Then** the admin sees an error notification and the invite link remains valid for manual sharing.

---

### User Story 4 - Admin Password Reset with Email Option (Priority: P2)

As an admin, I can reset a user's password and optionally send them a new invite email, so they can go through the self-service password setup process again.

From the user management area, an admin can trigger a password reset for any user. The confirmation dialog explains the consequences and offers a checkbox to send an invite email. The action invalidates the user's current password, generates a new invite token, and optionally emails the new setup link. The admin always sees the new invite link in a copyable format regardless of whether an email was sent.

**Why this priority**: Depends on P1 infrastructure (invite tokens and password setup page) and P2 email infrastructure. Valuable for security remediation and user support.

**Independent Test**: Can be tested by having an admin reset a user's password with and without the email option, verifying both flows work correctly.

**Acceptance Scenarios**:

1. **Given** an admin viewing user management, **When** they select "Reset Password" for a user, **Then** a confirmation dialog appears explaining that the user's current password will be invalidated, with a checkbox option to send an invite email.
2. **Given** an admin confirming a password reset with "Send invite email" checked, **When** the action completes, **Then** a new invite link is displayed, the user receives an invite email, and a success notification is shown.
3. **Given** an admin confirming a password reset without the email option, **When** the action completes, **Then** a new invite link is displayed in a copyable format and no email is sent.
4. **Given** a user whose password was reset, **When** they try to sign in with their old password, **Then** authentication fails with the message: "Your account hasn't been set up yet. Please use the invite link sent to your email, or contact your administrator."
5. **Given** a user whose password was reset, **When** they open the new invite link, **Then** they see the password setup page and can create a new password.
6. **Given** a non-admin user, **When** they attempt to access the password reset functionality, **Then** the action is denied.

---

### User Story 5 - Invite Link Security & Abuse Protection (Priority: P2)

As a system, invite links are protected against abuse to prevent unauthorized password setup on accounts that don't belong to the link holder.

Invite tokens are cryptographically random, long enough to prevent guessing, and expire after a configurable time window. Each token is single-use — once a password is set, the token cannot be reused. Rate limiting is applied to the password setup endpoint to prevent brute-force token guessing. The password setup page does not reveal whether an invalid token belongs to a real account.

**Why this priority**: Security requirement that must accompany the invite link flow. The token-based approach is inherently more secure than temporary passwords, but expiration and rate limiting add defense in depth.

**Independent Test**: Can be tested by attempting to use expired tokens, already-used tokens, and fabricated tokens, verifying all are rejected with appropriate messages.

**Acceptance Scenarios**:

1. **Given** an invite link with an expired token, **When** a user opens it, **Then** they see a message that the link has expired and should contact their administrator for a new one.
2. **Given** an invite link that has already been used, **When** someone opens it again, **Then** they see a message that the link has already been used, with a prompt to sign in.
3. **Given** a fabricated or invalid token in the URL, **When** someone visits the page, **Then** they see a generic "invalid link" message that does not reveal whether the token ever existed.
4. **Given** repeated requests to the password setup endpoint with invalid tokens, **When** the rate limit is exceeded, **Then** further requests are temporarily blocked.
5. **Given** a valid invite token, **When** the user sets their password, **Then** the token is permanently consumed and cannot be reused.

---

### User Story 6 - Send Invites to All Pending Users (Priority: P2)

As an admin, I want a global action to send invite emails to all users who haven't yet set up their password, so I can onboard existing users, newly created users, and bulk-imported users in one go — regardless of how or when they were added to the system.

From the user management area, an admin can see how many users have pending password setup (a visible count or filter). A "Send Invites to All Pending Users" action generates fresh invite tokens for any pending user who doesn't have a valid (non-expired) token, and sends invite emails to all of them. This works for users who existed before this feature was deployed, users created individually, and users added via bulk import — the action is not tied to any specific import batch. The admin sees a delivery summary (sent, failed) after the action completes.

**Why this priority**: This is essential for the initial rollout. When the feature is deployed, existing users in the system need a way to receive their invite links. It also serves as the ongoing "nudge" mechanism for any pending users regardless of origin.

**Independent Test**: Can be tested by having multiple pending users from different sources (pre-existing, individually created, bulk-imported), triggering the batch send, and verifying all receive emails with valid invite links.

**Acceptance Scenarios**:

1. **Given** the user management screen, **When** an admin views the user list, **Then** they can see which users have pending password setup (e.g., a status indicator or filterable column).
2. **Given** users with pending password setup exist, **When** the admin clicks "Send Invites to All Pending Users", **Then** a confirmation dialog shows the count of users who will receive emails.
3. **Given** the admin confirms the batch send, **When** the action completes, **Then** each pending user receives an invite email with a valid setup link, and the admin sees a summary (sent count, failed count).
4. **Given** a pending user whose invite token has expired, **When** the batch send runs, **Then** a fresh token is generated before sending the email.
5. **Given** a pending user who already has a valid (non-expired) token, **When** the batch send runs, **Then** the existing token is used in the email (no unnecessary token regeneration).
6. **Given** a user who has already completed password setup, **When** the batch send runs, **Then** that user is excluded and does not receive an email.
7. **Given** users from different origins (pre-existing, individually created, bulk-imported), **When** the batch send runs, **Then** all pending users are included regardless of how they were added.

---

### User Story 7 - Bulk Import with Invite Links (Priority: P3)

As an admin performing a bulk user import, I want each imported user to get a unique invite link, so I can distribute setup links immediately or send invites later using the global batch action.

When users are bulk-imported, each newly created account gets its own invite token. After the import completes, the admin can download a list of all generated invite links alongside user names and emails. For sending emails, the admin uses the global "Send Invites to All Pending Users" action from user management — bulk import itself does not have its own email send button.

**Why this priority**: Enhancement to the bulk import flow. The core invite link infrastructure (P1) must exist first. The global batch email action (Story 6) handles email delivery.

**Independent Test**: Can be tested by bulk-importing users, downloading the invite links, and verifying each link works for the corresponding user.

**Acceptance Scenarios**:

1. **Given** an admin performing a bulk user import, **When** the import completes, **Then** each newly created user has a unique invite token generated.
2. **Given** a completed bulk import, **When** the admin views the import results, **Then** they can download a list containing each new user's name, email, and invite link.
3. **Given** a bulk-imported user, **When** they open their invite link (from the downloaded list or a later invite email), **Then** they see the standard password setup page and can set their password.
4. **Given** a user who already exists in the system during bulk import, **When** the import processes that row, **Then** no new invite token is generated and the existing account is unchanged.

---

### Edge Cases

- What happens if an admin resets their own password? They are signed out and must use the new invite link to set a fresh password, like any other user.
- What happens if a user never uses their invite link and it expires? The admin can generate a new invite link via the "Reset Password" action and optionally send a new email.
- What happens if two admins reset the same user's password simultaneously? The last reset wins — only the most recently generated invite token is valid.
- What happens if a user bookmarks the invite link and returns after setting their password? They see a "link already used" message with a sign-in prompt.
- What happens to existing users when this feature is deployed? All existing users except the seed admin are flagged as "pending password setup" — they cannot sign in with their old passwords. The seed admin retains their existing password and can log in immediately to manage invites. The admin uses "Send Invites to All Pending Users" to email everyone their setup links.
- What happens if an admin wants to exempt certain existing users from the migration? Only the seed admin (the account created by `db:seed`) is exempt. All other users go through the invite flow for consistent security.
- What happens if the admin loses the invite link before sharing it? They can generate a new one using the "Reset Password" action and optionally send an email.
- What happens if the email service is down? The admin sees an error notification. The invite link remains valid and can be copied and shared manually. The admin can retry sending the email later.
- What happens if an admin sends an invite email and then resets the password again? The old invite link in the previously sent email becomes invalid. The admin can send a new email with the new link.
- What happens if a user clicks the invite link in an old email after a new token was generated? They see a generic "invalid link" message, protecting them from confusion while not revealing token details.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST generate a unique, cryptographically secure invite token for each newly created user account.
- **FR-002**: System MUST provide a dedicated password setup page accessible only via a valid invite token URL.
- **FR-003**: System MUST present a password setup form requiring a new password and confirmation, with real-time validation (minimum 8 characters, passwords must match).
- **FR-004**: System MUST consume the invite token and activate the account upon successful password setup, then sign the user in and redirect to the dashboard.
- **FR-005**: System MUST display the invite link to the admin after user creation or password reset, with a "Copy Link" option always available.
- **FR-006**: System MUST provide a "Send Invite Email" option alongside the invite link — emails are only sent when the admin explicitly triggers this action.
- **FR-007**: System MUST never send invite emails automatically — all email delivery is admin-initiated.
- **FR-008**: System MUST send a branded invite email containing the user's name, a call-to-action button with the setup link, and expiration information.
- **FR-009**: System MUST allow admins to re-send invite emails from user management for any user who hasn't completed password setup.
- **FR-010**: System MUST reject expired invite tokens with a clear message directing the user to contact their administrator.
- **FR-011**: System MUST reject already-used invite tokens with a message and a link to the sign-in page.
- **FR-012**: System MUST reject invalid or fabricated tokens with a generic error that does not reveal account existence.
- **FR-013**: System MUST provide admins with a "Reset Password" action that invalidates the user's current password, generates a new invite token, displays the link, and offers an option to send an invite email.
- **FR-014**: System MUST prevent users with pending password setup from signing in. When a pending user attempts to sign in, the system MUST display a specific message: "Your account hasn't been set up yet. Please use the invite link sent to your email, or contact your administrator."
- **FR-015**: System MUST present a single, unified sign-in page with one form and one button (no multiple sign-in options).
- **FR-016**: System MUST ensure all authentication pages (sign-in and password setup) are visually modern, responsive, and consistent with the application's theme system.
- **FR-017**: System MUST apply rate limiting to the password setup endpoint to prevent brute-force token guessing.
- **FR-018**: System MUST apply rate limiting to sign-in attempts (maximum 5 failed attempts per 10-minute window per email address).
- **FR-019**: System MUST provide a "Send Invites to All Pending Users" action in user management that sends invite emails to all users who haven't completed password setup, regardless of how or when they were added.
- **FR-020**: System MUST generate fresh invite tokens for pending users whose tokens have expired before sending batch invite emails, and reuse valid non-expired tokens.
- **FR-021**: System MUST process batch email sends synchronously with a visible progress indicator, and show the admin a delivery status summary upon completion (sent count, failed count).
- **FR-022**: System MUST display the count of pending users and allow filtering by setup status in user management.
- **FR-023**: System MUST generate invite links for each user during bulk import and provide a downloadable list of links after import completes.
- **FR-024**: System MUST set invite tokens to expire after 72 hours from generation.
- **FR-025**: System MUST flag all existing users except the seed admin as "pending password setup" upon initial deployment. The seed admin retains their existing password to bootstrap the invite process.

### Key Entities

- **User Account**: Extended with a flag indicating whether the account has completed password setup. Accounts without a set password cannot sign in via the normal login form.
- **Invite Token**: A cryptographically random, single-use token associated with a user account. Has an expiration time (72 hours). Once used to set a password, it is permanently consumed. Only one active token per user at a time (generating a new one invalidates the previous).
- **Invite Email**: A branded email sent on admin demand containing the user's name, a password setup link, and expiration details. Delivery status is tracked so the admin can see success/failure.
- **Password Setup Page**: A public-facing page that validates an invite token from the URL, displays the user's name, and allows them to create a password. Not accessible without a valid token.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of newly created users go through the self-service password setup flow — no temporary passwords are ever created or shared.
- **SC-002**: Users can complete the password setup process in under 60 seconds from opening the invite link.
- **SC-003**: Admins can create a user and send an invite email in a single workflow without leaving the page.
- **SC-004**: Admins can trigger a password reset, obtain a new invite link, and optionally send an email in under 3 clicks from user management.
- **SC-005**: Expired, used, and invalid invite tokens are all correctly rejected with appropriate, distinct messages.
- **SC-006**: The authentication pages are fully responsive at all breakpoints and support both light and dark themes.
- **SC-007**: Brute-force attempts on both the sign-in and password setup endpoints are blocked after exceeding rate limits.
- **SC-008**: No user can access any application page without having completed password setup.
- **SC-009**: No invite email is ever sent without explicit admin action.
- **SC-010**: Admins can send invite emails to all pending users in a single action, regardless of how users were added to the system.
- **SC-011**: After initial deployment, admins can onboard all existing users by sending batch invites without needing to recreate accounts.

## Assumptions

- Email delivery uses a third-party transactional email service (e.g., Resend). The service requires configuration (API key, sender domain) but is straightforward to integrate.
- Invite tokens expire after 72 hours. This is a reasonable default that balances security with practicality.
- Password requirements remain at minimum 8 characters (matching the existing user creation validation).
- Only one active invite token exists per user at a time. Generating a new token (via reset) invalidates any previous token.
- Upon deployment, all existing users except the seed admin are flagged as pending password setup. The seed admin retains their existing password to bootstrap the system. All other users go through the new invite flow for a clean security baseline.
- Rate limiting is per-email-address for sign-in and per-IP for the password setup endpoint.
- The admin password field in the user creation form is removed — replaced entirely by the invite link flow.
- Email delivery failures are non-blocking — the invite link always works as a fallback. Admins can retry sending.
