# Tasks: First Login Experience

**Input**: Design documents from `/specs/017-first-login-experience/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/server-actions.md, quickstart.md

**Tests**: Not explicitly requested — test tasks omitted. Add tests as needed during implementation.

**Organization**: Tasks grouped by user story. 7 user stories mapped from spec.md.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install dependencies and configure environment for the new feature

- [x] T001 Install new dependencies: `pnpm add resend @react-email/components`
- [x] T002 [P] Add `RESEND_API_KEY` and `FROM_EMAIL` to `.env.local.example` with comments explaining each
- [x] T003 [P] Create `src/emails/` directory for React Email templates

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema changes, core utilities, and validation schemas that ALL user stories depend on

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Add `inviteTokenStatus` enum (`active`, `consumed`, `invalidated`) and `inviteTokens` table to `src/lib/db/schema.ts` per data-model.md — columns: `id`, `userId` (FK → users, unique where active), `tokenHash` (varchar 64, indexed), `status`, `expiresAt`, `createdAt`, `consumedAt` (nullable)
- [x] T005 Add `mustChangePassword` boolean column (default `true`) to `users` table in `src/lib/db/schema.ts`
- [x] T006 Generate and apply database migration: `pnpm db:generate && pnpm db:migrate` — migration must set `mustChangePassword = false` for seed admin (`admin@company.com`)
- [x] T007 [P] Create `src/lib/invite.ts` — token utilities: `generateToken()` returns `{ raw, hash }` using `crypto.randomBytes(32)` + SHA-256, `hashToken(raw)` for lookup, `buildInviteUrl(raw)` constructs full URL `/setup-password/{token}`
- [x] T008 [P] Create `src/lib/rate-limit.ts` — in-memory Map-based rate limiter: `isRateLimited(key, config)` returns boolean, `resetLimit(key)` clears attempts, `getClientIp(request)` extracts IP from headers. Config type: `{ maxAttempts: number; windowMs: number }`
- [x] T009 [P] Create `src/lib/email.ts` — Resend service wrapper: initialize `new Resend(process.env.RESEND_API_KEY)`, export `sendEmail({ to, subject, react })` returning `{ success, data?, error? }`, validate env vars on import
- [x] T010 [P] Add `setupPasswordSchema` to `src/lib/validators.ts` — validates `{ token: string, password: string (min 8), confirmPassword: string }` with `refine` to ensure passwords match. Also add `inviteTokenSchema` for token param validation

**Checkpoint**: Foundation ready — schema deployed, utilities available, user story implementation can begin

---

## Phase 3: User Story 1 — Self-Service Password Setup via Invite Link (Priority: P1) MVP

**Goal**: Users can open an invite link, set their password, and gain access to the app. Admins see invite links after creating users.

**Independent Test**: Create a user via admin form → copy invite link → open in browser → set password → verify dashboard access

### Implementation for User Story 1

- [x] T011 [US1] Create `src/actions/invite.ts` — implement `generateInviteToken(userId)` server action: invalidate existing active token for user, generate new token via `src/lib/invite.ts`, insert into `inviteTokens` table with 72h expiry, return `{ success: true, data: { inviteUrl } }`. Requires admin auth via `requireAdmin()`
- [x] T012 [US1] Implement `validateInviteToken(token)` in `src/actions/invite.ts` — hash the raw token, look up in DB where `status = 'active'` and `expiresAt > now()`, return user name/email on success, return typed error (`expired`, `consumed`, `invalid`) on failure. No auth required (public)
- [x] T013 [US1] Implement `setupPassword(input)` in `src/actions/invite.ts` — validate via `setupPasswordSchema`, apply rate limiting per IP via `src/lib/rate-limit.ts` (10 attempts/minute), validate token, hash new password with bcrypt (salt 12), update `users.passwordHash` + set `mustChangePassword = false`, consume token (`status = 'consumed'`, `consumedAt = now()`), return redirect URL. No auth required
- [x] T014 [US1] Create `src/app/(auth)/setup-password/[token]/page.tsx` — server component that calls `validateInviteToken(params.token)`, renders password setup form on success, renders appropriate error message on failure (expired → "Link expired, contact admin", consumed → "Already used" + sign-in link, invalid → generic "Invalid link")
- [x] T015 [US1] Create `src/app/(auth)/setup-password/[token]/setup-password-form.tsx` — client component with React Hook Form + `setupPasswordSchema`, fields: new password + confirm password with real-time validation, submit calls `setupPassword` action, on success redirect to dashboard via `router.push`, show inline errors on failure
- [x] T016 [US1] Modify `src/lib/auth.ts` — in the credentials `authorize()` callback, after finding the user, check `mustChangePassword`: if `true`, throw/return error with message "Your account hasn't been set up yet. Please use the invite link sent to your email, or contact your administrator." User never gets a session
- [x] T017 [US1] Modify `src/actions/users.ts` `createUser()` — remove `password` field from input, set `passwordHash` to random bytes (un-signable), set `mustChangePassword = true` (default), after insert call `generateInviteToken(newUser.id)`, return `inviteUrl` in response data
- [x] T018 [US1] Modify `src/app/users/new/new-user-form.tsx` — remove password field from form, after successful creation show invite link in a dialog/card with a "Copy Link" button using `navigator.clipboard.writeText()`, update Zod schema reference to match new `createUser` input (no password)
- [x] T019 [US1] Modify `src/lib/validators.ts` — update `userSchema` to remove the `password` field (it's no longer set at creation time). Add a `createUserSchema` without password if needed to preserve the existing `userSchema` for other uses

**Checkpoint**: User Story 1 complete — full invite link → password setup → dashboard flow works. Admin creates user, copies link, user sets password.

---

## Phase 4: User Story 2 — Unified Modern Authentication Page (Priority: P1)

**Goal**: Login and password setup pages share a modern, cohesive visual design with a single sign-in form and one button.

**Independent Test**: Navigate to `/login` and `/setup-password/[token]` — verify responsive design, theme support, visual consistency, single sign-in button

### Implementation for User Story 2

- [x] T020 [US2] Redesign `src/app/(auth)/layout.tsx` — create a modern, visually engaging auth layout: centered card on a themed background (subtle gradient or pattern), application branding/logo, responsive at all breakpoints, supports light/dark mode via existing theme system. Use shadcn/ui components and Tailwind design tokens only
- [x] T021 [US2] Redesign `src/app/(auth)/login/login-form.tsx` — modern single sign-in form: clean typography, one email field, one password field, one "Sign In" button (no multiple sign-in options), polished error display, loading state with spinner/disabled button. Must feel visually premium
- [x] T022 [US2] Redesign `src/app/(auth)/login/page.tsx` — update page content to work with new layout: application name as heading, welcoming subtext, pass through to redesigned login form
- [x] T023 [US2] Style `src/app/(auth)/setup-password/[token]/setup-password-form.tsx` to match the login page design language — same card style, typography, spacing, button style. Welcome message with user's name. Consistent error/success states
- [x] T024 [US2] Verify visual consistency: both `/login` and `/setup-password/[token]` pages must share identical card width, padding, font sizes, button styles, and theme behavior. Test at mobile (375px), tablet (768px), and desktop (1280px) breakpoints

**Checkpoint**: User Story 2 complete — auth pages are modern, responsive, theme-aware, and visually consistent

---

## Phase 5: User Story 3 — Admin-Controlled Invite Emails (Priority: P2)

**Goal**: Admins can send branded invite emails on demand. Emails are never sent automatically.

**Independent Test**: Create a user → click "Send Invite Email" → verify email arrives with correct link and branding. Then create another user → only click "Copy Link" → verify no email was sent.

### Implementation for User Story 3

- [x] T025 [P] [US3] Create `src/emails/invite-email.tsx` — React Email template: branded layout with app name/logo, greeting with user's name ("Welcome, {name}!"), explanation text, prominent "Set Up Your Account" CTA button linking to invite URL, expiration notice ("This link expires in 72 hours"), fallback URL text below button. Use `@react-email/components` (Html, Head, Body, Container, Button, Text, Section, Tailwind)
- [x] T026 [US3] Implement `sendInviteEmail(userId)` in `src/actions/invite.ts` — admin-only action: look up user and active token (generate new one if expired/missing), build invite URL, send email via `src/lib/email.ts` with invite-email template, return `{ success, data: { emailId } }` or error
- [x] T027 [US3] Create `src/components/invite-link-dialog.tsx` — reusable dialog component shown after user creation or password reset: displays the invite URL in a read-only input with "Copy Link" button, "Send Invite Email" button that calls `sendInviteEmail`, shows toast on copy success, shows toast on email sent/failed. Uses shadcn/ui Dialog, Button, Input, and Sonner toast
- [x] T028 [US3] Update `src/app/users/new/new-user-form.tsx` — replace the simple copy-link card (from T018) with the `InviteLinkDialog` component, passing the invite URL and user ID
- [x] T029 [US3] Add "Send Invite" action to `src/app/users/users-table.tsx` — for users where `mustChangePassword = true`, add a row action button "Send Invite" that calls `sendInviteEmail(userId)` and shows toast result

**Checkpoint**: User Story 3 complete — admins have full control over invite email delivery, copy-link always available as fallback

---

## Phase 6: User Story 4 — Admin Password Reset with Email Option (Priority: P2)

**Goal**: Admins can reset any user's password, invalidating their old credentials and generating a new invite link with optional email.

**Independent Test**: Reset a user's password with email option checked → verify old password fails → verify invite email arrives → verify user can set new password via link

### Implementation for User Story 4

- [x] T030 [US4] Implement `resetUserPassword({ userId, sendEmail })` in `src/actions/invite.ts` — admin-only action: set user's `passwordHash` to random bytes, set `mustChangePassword = true`, call `generateInviteToken(userId)`, if `sendEmail` is true call `sendInviteEmail(userId)`, record in change history table, return `{ inviteUrl, emailSent }`
- [x] T031 [US4] Add "Reset Password" action to `src/app/users/users-table.tsx` — row action button for each user, opens confirmation dialog (shadcn/ui AlertDialog): explains consequences ("This will invalidate {name}'s current password"), checkbox "Send invite email to {email}", confirm/cancel buttons. On confirm calls `resetUserPassword`, shows `InviteLinkDialog` with result
- [x] T032 [US4] Add "Reset Password" button to `src/app/users/[id]/user-detail-client.tsx` — same behavior as table action but from the user detail page. Reuse the same confirmation dialog and invite link dialog components

**Checkpoint**: User Story 4 complete — admins can reset passwords and optionally email new invite links

---

## Phase 7: User Story 5 — Invite Link Security & Abuse Protection (Priority: P2)

**Goal**: Rate limiting on sign-in and password setup endpoints, token expiry enforcement, no information leakage on invalid tokens.

**Independent Test**: Attempt 6 failed logins for same email → verify 6th is blocked. Try expired/consumed/fabricated tokens → verify correct error messages with no info leakage.

### Implementation for User Story 5

- [x] T033 [US5] Integrate sign-in rate limiting in `src/lib/auth.ts` — in the `authorize()` callback, before DB lookup, call `isRateLimited(email.toLowerCase(), { maxAttempts: 5, windowMs: 10 * 60 * 1000 })`. If limited, return `null` (NextAuth will show generic error). On successful auth, call `resetLimit(email)`
- [x] T034 [US5] Verify rate limiting in `setupPassword` action in `src/actions/invite.ts` — ensure T013 already applies IP-based rate limiting (10 attempts/minute). If not integrated yet, add it now using `getClientIp(request)` from `src/lib/rate-limit.ts`
- [x] T035 [US5] Verify token error messages in `src/app/(auth)/setup-password/[token]/page.tsx` — ensure expired tokens show "This link has expired. Please contact your administrator for a new one.", consumed tokens show "This link has already been used." + sign-in link, invalid tokens show generic "This link is not valid." with no account details leaked

**Checkpoint**: User Story 5 complete — abuse protection active on all auth endpoints

---

## Phase 8: User Story 6 — Send Invites to All Pending Users (Priority: P2)

**Goal**: Admins can batch-send invite emails to all users who haven't set up their password, with a progress indicator and delivery summary.

**Independent Test**: Have 3+ pending users from different sources → click "Send Invites to All Pending Users" → verify all receive emails → verify delivery summary shows correct counts

### Implementation for User Story 6

- [x] T036 [US6] Implement `sendBatchInviteEmails()` in `src/actions/invite.ts` — admin-only action: query all users where `mustChangePassword = true`, for each: generate token if missing/expired (reuse valid ones), send invite email, track sent/failed counts, return aggregate `{ sent, failed, total, errors }`. Process synchronously
- [x] T037 [US6] Add pending user count and filter to `src/app/users/users-table.tsx` — add a "Setup Status" column showing "Pending" (badge) or "Active" for each user based on `mustChangePassword`. Add a faceted filter for this column. Show total pending count near the table header
- [x] T038 [US6] Add "Send Invites to All Pending Users" button to `src/app/users/page.tsx` — visible when pending users exist, opens confirmation dialog showing count ("Send invite emails to {N} pending users?"), on confirm calls `sendBatchInviteEmails()`, shows progress indicator during send, shows delivery summary toast on completion (sent/failed counts)
- [x] T039 [US6] Add pending user count to the users page header in `src/app/users/page.tsx` — query pending count server-side, display as a badge or info text (e.g., "5 users pending setup")

**Checkpoint**: User Story 6 complete — admins can onboard all pending users in one action regardless of origin

---

## Phase 9: User Story 7 — Bulk Import with Invite Links (Priority: P3)

**Goal**: Bulk-imported users get invite tokens, and admins can download a list of all invite links after import.

**Independent Test**: Bulk import 3 users via CSV → verify each gets an invite token → download invite links list → verify each link works for the corresponding user

### Implementation for User Story 7

- [x] T040 [US7] Modify `src/actions/users.ts` `bulkImportUsers()` — remove default password "changeme123" logic, set `passwordHash` to unique random bytes per user, set `mustChangePassword = true`, after inserting each new user call `generateInviteToken(userId)`, collect `{ name, email, inviteUrl }` for all new users, return in response data
- [x] T041 [US7] Modify `src/app/users/import/bulk-import-form.tsx` — after successful import, show a "Download Invite Links" button that generates and downloads a CSV file with columns: Name, Email, Invite Link. Only include newly created users (not updated/skipped ones). Use Blob + URL.createObjectURL for client-side download

**Checkpoint**: User Story 7 complete — bulk import produces invite tokens and a downloadable link list

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Final cleanup, consistency checks, and deployment preparation

- [x] T042 [P] Update `src/lib/db/seed.ts` — ensure seed admin has `mustChangePassword: false` so the seed script is consistent with the migration
- [x] T043 [P] Update `.env.local.example` — add `RESEND_API_KEY` and `FROM_EMAIL` with description comments
- [x] T044 Verify `pnpm build` succeeds with zero TypeScript errors and zero ESLint warnings
- [x] T045 Verify `pnpm lint` passes with zero warnings across all new and modified files
- [x] T046 Run `pnpm typecheck` to confirm strict mode compliance across all new code
- [x] T047 Manual smoke test: full flow — seed DB → login as admin → create user → copy invite link → open in incognito → set password → verify dashboard access → reset password from admin → verify old password fails → use new invite link

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 — core MVP
- **US2 (Phase 4)**: Depends on Phase 3 (needs setup-password page to exist for design consistency)
- **US3 (Phase 5)**: Depends on Phase 2 (email infrastructure), can start after Phase 2 but best after US1
- **US4 (Phase 6)**: Depends on US1 (token infrastructure) and US3 (email + invite dialog)
- **US5 (Phase 7)**: Depends on US1 (rate limit integration targets exist)
- **US6 (Phase 8)**: Depends on US3 (email sending) and US1 (token generation)
- **US7 (Phase 9)**: Depends on US1 (token generation in bulk import)
- **Polish (Phase 10)**: Depends on all user stories being complete

### User Story Dependencies

```
Phase 1 (Setup) → Phase 2 (Foundational)
                      ↓
                   Phase 3 (US1: Invite Link + Password Setup) ← MVP
                      ↓
              ┌───────┴───────┐
              ↓               ↓
        Phase 4 (US2)   Phase 5 (US3: Emails)
                              ↓
                    ┌─────────┼─────────┐
                    ↓         ↓         ↓
              Phase 6    Phase 7    Phase 8
              (US4)      (US5)     (US6)
                                      ↓
                                  Phase 9 (US7)
                                      ↓
                                  Phase 10 (Polish)
```

### Within Each User Story

- Utilities/actions before UI components
- Server components before client components
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

**Phase 2**: T007, T008, T009, T010 can all run in parallel (different files, no dependencies)
**Phase 5**: T025 can run in parallel with other US3 tasks (email template is independent)
**Phase 10**: T042, T043 can run in parallel

---

## Parallel Example: Phase 2 (Foundational)

```bash
# After T004-T006 (schema) complete, launch all utilities in parallel:
Task T007: "Create token utilities in src/lib/invite.ts"
Task T008: "Create rate limiter in src/lib/rate-limit.ts"
Task T009: "Create email service in src/lib/email.ts"
Task T010: "Add validation schemas in src/lib/validators.ts"
```

## Parallel Example: Phase 3 (User Story 1)

```bash
# T011 and T012 can run in parallel (different functions in same file, but no deps):
Task T011: "Implement generateInviteToken in src/actions/invite.ts"
Task T012: "Implement validateInviteToken in src/actions/invite.ts"
# Then T013 depends on both, T014/T015 depend on T012/T013
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T003)
2. Complete Phase 2: Foundational (T004–T010)
3. Complete Phase 3: User Story 1 (T011–T019)
4. **STOP and VALIDATE**: Create user → copy invite link → set password → access dashboard
5. Deploy/demo if ready — this alone delivers the core security value

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. **US1** → Invite link + password setup works → **Deploy (MVP!)**
3. **US2** → Auth pages are modern and polished → Deploy
4. **US3** → Admin can send invite emails → Deploy
5. **US4** → Admin can reset passwords with email → Deploy
6. **US5** → Rate limiting active → Deploy
7. **US6** → Batch invite send for all pending users → Deploy
8. **US7** → Bulk import generates invite links → Deploy
9. Polish → Final cleanup → Deploy

### Parallel Team Strategy

With multiple developers after Phase 2:
- Developer A: US1 (core invite flow) → US4 (password reset)
- Developer B: US2 (auth page redesign) → US5 (rate limiting)
- Developer C: US3 (email infrastructure) → US6 (batch send) → US7 (bulk import)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- No test tasks generated (not explicitly requested) — add as needed
