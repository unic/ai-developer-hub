# Research: 017 First Login Experience

**Date**: 2026-03-17

## R1: Email Service Integration

**Decision**: Use Resend as the transactional email service with React Email for templates.

**Rationale**: Resend is the most popular email service for Next.js — simple TypeScript API, first-class React Email support, generous free tier (100 emails/day, 3000/month). The `resend` package returns `{ data, error }` matching the project's existing action return pattern. React Email provides typed JSX components (`Button`, `Container`, `Text`, `Tailwind`) that render to cross-client HTML.

**Alternatives considered**:
- SendGrid: More mature but heavier SDK, XML-based templates, overkill for this scale.
- Postmark: Good deliverability but no native React component system.
- Nodemailer + SMTP: Too low-level, requires managing SMTP connections and HTML templates manually.

**Key implementation details**:
- Packages: `resend`, `@react-email/components`
- Env vars: `RESEND_API_KEY`, `FROM_EMAIL`
- Service abstraction: `src/lib/email.ts` wrapping `new Resend(key)` with typed `send()` method
- Email template: `src/emails/invite-email.tsx` using React Email components + Tailwind
- Error handling: Resend returns typed errors (401 auth, 429 rate limit, 5xx server). Non-blocking — invite link always works as fallback.

## R2: Invite Token Generation

**Decision**: Use Node.js `crypto.randomBytes(32)` to generate 64-character hex tokens. Store hashed (SHA-256) in database, expose raw token only in URL.

**Rationale**: The project already uses `crypto.randomBytes` in `src/lib/crypto.ts` for API key encryption. 32 bytes (256 bits) of randomness is cryptographically secure and standard for URL tokens. Storing the hash (not the raw token) means a database breach doesn't expose valid invite links. SHA-256 is fast enough for single lookups and doesn't need bcrypt's slow hashing (tokens are high-entropy, not user-chosen passwords).

**Alternatives considered**:
- UUID v4: Only 122 bits of randomness, shorter but less secure.
- JWT: Adds complexity (signing key, payload parsing), unnecessary since we need database lookup anyway for single-use enforcement.
- bcrypt hash: Too slow for token validation on every page load; bcrypt is for low-entropy passwords.

## R3: Rate Limiting

**Decision**: In-memory Map-based rate limiter with no external dependencies.

**Rationale**: This is an internal admin tool with <500 users on a single-instance deployment. An in-memory solution is the simplest approach — ~50 lines of code, zero dependencies, zero latency overhead. Memory resets on deployment, but that's acceptable for this scale.

**Alternatives considered**:
- @upstash/ratelimit: Requires Redis, adds infrastructure dependency. Overkill for this scale.
- Database-backed: Adds a table and query per request. Could be a future upgrade if multi-instance is needed.
- express-rate-limit: Express middleware, awkward to integrate with Next.js App Router server actions.

**Implementation**:
- New file: `src/lib/rate-limit.ts`
- Sign-in: 5 attempts per email per 10-minute window
- Password setup endpoint: 10 attempts per IP per minute
- Clear on successful auth

## R4: Password Setup Page Architecture

**Decision**: Dedicated route at `/setup-password/[token]` as a public page (no auth required). After successful password set, programmatically sign in and redirect.

**Rationale**: The invite link must work without any prior authentication. The token in the URL is the authentication factor. The page validates the token server-side, renders the form if valid, and processes the password change as a server action. After the password is set and the token consumed, the server action calls `signIn()` to create a session and returns a redirect URL.

**Alternatives considered**:
- Modal on the login page: Would require complex state management and wouldn't work as a shareable link.
- API route + separate SPA page: Unnecessary complexity; server components + server actions handle this natively.

## R5: User Schema Extension

**Decision**: Add `mustChangePassword` boolean column (default `true`) to the existing `users` table, plus a new `invite_tokens` table.

**Rationale**: A boolean flag on the user record is the simplest way to track password setup status. The `invite_tokens` table is separate because tokens have their own lifecycle (creation, expiry, consumption) and a 1:1 relationship with users (only one active token per user). This follows the existing schema pattern where related data lives in separate tables (e.g., `github_profiles`, `change_history`).

**Alternatives considered**:
- Storing token in the users table: Couples token lifecycle to user record, makes cleanup harder.
- Using the existing `status` enum: Adding a third status would break existing queries that expect active/inactive.
- Using a `passwordHash IS NULL` check: Current user creation always requires a password hash. Changing this would break existing flows.

## R6: Migration Strategy for Existing Users

**Decision**: Database migration sets `mustChangePassword = true` for all users except the seed admin (identified by email `admin@company.com`). Generate invite tokens for all flagged users in the same migration.

**Rationale**: The seed admin is the bootstrap account — it must retain access to send invites to everyone else. All other users go through the invite flow for a clean security baseline. Generating tokens in the migration means the "Send Invites to All Pending Users" action works immediately after deployment.

## R7: Auth Flow Modification

**Decision**: Modify the NextAuth credentials `authorize()` callback to check `mustChangePassword`. If true, return the user but include the flag in the JWT/session. Middleware checks the flag and redirects to a "pending setup" info page (not the setup page itself, since the user needs the token URL).

**Rationale**: We can't block login entirely for pending users because the spec says they should see "Your account hasn't been set up yet" when they try to sign in. The cleanest approach is to reject the sign-in with a specific error message in the credentials provider, so pending users never get a session at all. They can only gain access via the invite token flow.
